package com.campusflow.service.aspect;

import com.campusflow.common.constant.ActionConstant;
import com.campusflow.common.context.AuditContext;
import com.campusflow.common.context.UserContext;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.po.AuditLogs;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.aop.support.AopUtils;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * {@link MyLog} 注解的落地切面：把「谁、以什么身份、对哪个对象、做了什么、结果如何、从哪来」写成一行
 * {@code audit_logs}。
 *
 * <p>用法（注解已在 {@code UsersServiceImpl#login} 上生效）：
 * <pre>{@code
 * @MyLog(value = "user", description = "进行登录操作")
 * public Result login(loginDTO dto) { ... }
 * }</pre>
 * {@code value} = 资源类型（落到 {@code resource_type}），{@code description} 目前只用于排障日志。
 *
 * <h3>一、action 怎么拼（与种子数据对齐）</h3>
 * 注解里没有 {@code action} 字段，用的是「{@code value + "." + 方法名规范动词}」：
 * <ul>
 *   <li>{@code login()} + value="user" → {@code user.login}（与 {@code audit_logs} 的种子行一致）；</li>
 *   <li>{@code createTask()} + value="task" → {@code task.create}，{@code updateDocument()} → {@code document.update}，</li>
 * </ul>
 * 也就是<b>方法名的动词前缀会被规范化并吃掉后面的名词</b>（create/add/insert/save/new → create；
 * update/modify/edit → {@link com.campusflow.common.constant.ActionConstant#ACTION_UPDATE}；
 * delete/remove/drop → {@link com.campusflow.common.constant.ActionConstant#ACTION_DELETE}；
 * 其余动词如 login/publish/retract 原样保留）。前缀不认识时退化成一整段方法名，不会丢信息。
 *
 * <h3>二、operator 从哪来（登录是特例）</h3>
 * 解析顺序：{@link UserContext}（JwtInterceptor 塞的）→ 返回体里的用户对象（{@code data.user} /
 * {@code currentUser} / {@code operator}）→ 入参上的 {@code userId} / {@code operatorId}。
 * <p>🔴 <b>为什么必须看返回体</b>：{@code /auth/login} 在 {@code webConfig} 里被排除在 JwtInterceptor
 * 之外，此刻还没有 token，{@code UserContext} 必然是空的 —— 但登录恰恰是最需要留痕的操作。
 * 所以登录这条只能从返回的 {@code LoginVo.user} 里取 id/role（种子数据里 {@code user.login} 那行
 * {@code operator_user_id=18, operator_role=student} 就是这么来的）。
 * <p>⚠️ <b>有意不从入参的裸 {@code id} 取 operator</b>：{@code updateTask(Long id, ...)} 里的 {@code id}
 * 是被操作对象，不是操作人，取错会把「谁改的」记成「改了谁」。同理 {@code resource_id} 优先取
 * <b>出参</b>的 {@code id}（新建/更新后的对象），没有才退到入参。
 *
 * <h3>三、落库是异步的，但"抓现场"必须是同步的</h3>
 * 本切面在请求线程上只做一件事：<b>把现场冻结成 {@link AuditLogRecord}</b>，然后交给
 * {@link AuditLogWriter} 在独立线程池里落库（{@code @Async}）。这样响应不再等
 * 「回查 {@code users.role}」和「INSERT {@code audit_logs}」这两个 RTT。
 *
 * <p>🔴 <b>为什么不能直接把 {@code joinPoint} 传给异步线程</b>——这是本次改造最容易踩的坑，
 * 三个现场全部"离开请求线程就取不到"：
 * <ul>
 *   <li>{@code UserContext} / {@code RequestContextHolder} 都是 {@link ThreadLocal} → 异步线程里是 {@code null}；</li>
 *   <li>{@code HttpServletRequest} 在请求结束后被容器回收，留着引用去读 header 是未定义行为
 *       （所以 ip / User-Agent / requestId 一律当场取成 String）；</li>
 *   <li>{@code ProceedingJoinPoint.getArgs()} 返回的是<b>活引用不是副本</b>，方法已返回还去碰它没有保证。</li>
 * </ul>
 * 所以这里<b>刻意不用</b> {@code TaskDecorator} 去透传 {@code ThreadLocal}：透传等于把 request 对象和过期身份
 * 带进池化线程，线程复用时还可能串到下个请求上（要不出错、要不出「张三的操作记到李四名下」这种更糟的错），
 * 必须在 {@code afterCompletion} 里清理才安全 —— 冻结成值对象则完全没有这类问题，成本只是几个 String。
 *
 * <p>⚠️ <b>语义变化</b>：审计 INSERT 从此<b>不在请求线程的业务事务里</b>了。业务回滚时审计行照样落
 * （这对审计是好事），反过来审计失败也不会回滚业务（与改造前一致，见下条）。
 *
 * <h3>四、切面自身失败绝不阻断业务</h3>
 * 「抓现场 + 投递任务」整个包在 {@code try/catch} 里，失败只打一行 {@code log.error}：审计是旁路，
 * 不能因为它把一次正常的登录/发文变成 500。代价是「日志静默丢失」——所以这里记 error 级别，
 * 配合 {@code logs/} 目录的应用日志能事后捞。
 * <p>投递本身在一种情况下是<b>慢的</b>：审计队列满时线程池会退回调用线程执行（{@code CallerRunsPolicy}），
 * 那一次请求会连带把 INSERT 一起等完。这是有意为之 —— 宁可偶尔慢，也不要静默丢审计行。
 *
 * <h3>五、脱敏与截断：必须始终是合法 JSON</h3>
 * {@code before_data} / {@code after_data} 是 MySQL 的 {@code json} 列，<b>写入非法 JSON 会整行插入失败</b>
 * （然后被上面的 catch 吞掉 → 日志静默消失）。所以这里不是"截字符串"，而是
 * 「先转成 {@link JsonNode} → 递归脱敏 → 再序列化」，超长时换成
 * {@code {"_truncated":true,"_originalLength":N,"_preview":"..."}} 这种<b>天然合法</b>的结构。
 * 脱敏按<b>键名关键字</b>命中（password / token / secret / credential / …），值统一替换成 {@code ***}——
 * 登录返回体里的 {@code access_token}、{@code refresh_token} 就是靠这条规则挡住的，
 * <b>否则审计表里会躺着一批可用的 JWT</b>。
 * <p>⚠️ 序列化仍留在请求线程（CPU 开销，无 I/O）：代价可控，换来的是交给异步线程的对象里
 * <b>只剩 String</b>，不存在任何跨线程共享业务对象的隐患。
 *
 * <h3>六、两列数据的语义（与表注释的差异，别误读）</h3>
 * <ul>
 *   <li>{@code after_data} = 成功时的<b>出参摘要</b>（{@code Result.data}，脱敏+限长）；失败留空。</li>
 *   <li>{@code before_data} = <b>入参摘要</b>（单个入参直接序列化对象，多个则序列化成数组）。</li>
 * </ul>
 * 本切面<b>不查库回填「变更前的值」</b>——那需要每种业务自己知道去哪张表取旧值，切面层面无法通用；
 * 要的是真正的 before/after diff 时，应由业务在改库前后显式写（或后续增加一个可选的
 * {@code beforeLoader}）。现在这样至少保证：谁、在什么请求下、拿了什么参数、得到了什么结果，全程可追。
 *
 * <h3>七、request_id 目前由本切面自己生成</h3>
 * 契约要求响应体带 {@code request_id}，但工程里还没有对应的 Filter（见 {@code docs/admin-metrics/README.md} §六），
 * 于是这里：优先 {@code X-Request-Id} 请求头 → request 属性（同一次请求内多条日志共用同一个值）
 * → 兜底 {@code req_<uuid>}。将来补了 Filter，把它塞进同名请求属性即可无缝接上，本类无需改。
 * <p>⚠️ 注意这个 id <b>只在审计行内部自洽</b>，和响应体里（目前根本不存在的）{@code request_id} 还不通。
 *
 * @see AuditLogRecord 现场快照包含什么、为什么必须同步冻结
 * @see AuditLogWriter 异步写入端（回查 role + INSERT）
 * @see com.campusflow.service.config.AsyncConfig 线程池与降级策略
 */
@Slf4j
@Aspect
@Component
public class LogAspect {

    /** 同一次请求内多条审计行共用同一个 requestId（挂在 request 属性上，不依赖全局 Filter）。 */
    private static final String REQUEST_ID_ATTRIBUTE = "campusflow.requestId";
    private static final String REQUEST_ID_HEADER = "X-Request-Id";
    private static final String REQUEST_ID_PREFIX = "req_";

    private static final String RESULT_SUCCESS = "success";
    private static final String RESULT_FAILURE = "failure";
    private static final String MASK = "***";

    /** 字段长度上限一律对齐建表语句，宁可截断也不要因超长整行插入失败。 */
    private static final int MAX_ACTION_LENGTH = 80;
    private static final int MAX_RESOURCE_TYPE_LENGTH = 64;
    private static final int MAX_REQUEST_ID_LENGTH = 80;
    private static final int MAX_USER_AGENT_LENGTH = 512;
    private static final int MAX_ERROR_LENGTH = 1000;
    private static final int MAX_IP_LENGTH = 45;

    /** JSON 落库前的长度上限；超限只留 preview（仍是合法 JSON）。 */
    private static final int MAX_JSON_LENGTH = 2000;
    private static final int PREVIEW_LENGTH = 500;
    /** 脱敏递归深度上限：超过就整块清空，宁可丢字段也不漏字段。 */
    private static final int MAX_MASK_DEPTH = 8;

    /** 命中即脱敏的键名关键字（小写、包含匹配）。 */
    private static final List<String> SENSITIVE_KEYWORDS = List.of(
            "password", "passwd", "pwd", "token", "secret", "credential",
            "authorization", "cookie", "session", "encrypted", "private");

    /** 方法名前缀 → 规范动词；长的前缀优先匹配。 */
    private static final Map<String, String> VERB_ALIAS;
    private static final List<String> VERBS_LONGEST_FIRST;

    static {
        Map<String, String> alias = new HashMap<>();
        for (String verb : new String[]{"create", "add", "insert", "save", "new"}) {
            alias.put(verb, "create");
        }
        for (String verb : new String[]{"update", "modify", "edit"}) {
            alias.put(verb, ActionConstant.ACTION_UPDATE);
        }
        for (String verb : new String[]{"delete", "remove", "drop"}) {
            alias.put(verb, ActionConstant.ACTION_DELETE);
        }
        for (String verb : new String[]{"login", "logout", "register", "reset", "publish", "offline",
                "archive", "upload", "download", "retract", "resolve", "approve", "reject",
                "cancel", "retry", "import", "export"}) {
            alias.putIfAbsent(verb, verb);
        }
        VERB_ALIAS = Map.copyOf(alias);
        List<String> verbs = new ArrayList<>(VERB_ALIAS.keySet());
        verbs.sort((left, right) -> right.length() - left.length());
        VERBS_LONGEST_FIRST = List.copyOf(verbs);
    }

    private final ObjectMapper objectMapper;

    /**
     * 异步写入端。注入的是<b>代理</b>（本类是个普通 {@code @Component}，{@code @Async} 注解在
     * {@link AuditLogWriter#write} 上），所以调用会被切到审计线程池 —— 这也正是 {@code @Async}
     * 的生效条件：<b>必须跨 Bean 调用</b>，同类内部自调用是不走代理的。
     */
    private final AuditLogWriter auditLogWriter;

    public LogAspect(ObjectMapper objectMapper, AuditLogWriter auditLogWriter) {
        this.objectMapper = objectMapper;
        this.auditLogWriter = auditLogWriter;
    }

    /**
     * 方法级 {@code @MyLog} 与类级 {@code @MyLog} 一起拦。
     *
     * <p>🔴 <b>注解不用 AspectJ 的绑定参数，改成自己反射取</b>（2026-09-21 用最小 Spring 上下文实测踩到）：
     * 写成 {@code @Around("@annotation(myLog) || @within(myLog)")} 配
     * {@code around(ProceedingJoinPoint, MyLog myLog)} 时，<b>方法级</b> {@code @MyLog(value = "user")}
     * 被绑定进来的实例是<b>默认值</b>（{@code value=""}）—— 切面照样执行、照样落库，
     * 但 action 记成 {@code demo.login}、resource_type 退化成类名，<b>静默错口径且无任何报错</b>；
     * 而类级注解那条分支是正常的，所以"能落库"根本发现不了。
     * <p>根因是联合切点里同一个注解参数被 {@code @annotation} 与 {@code @within} 两条分支重复绑定，
     * 取不到方法上那份就退回了合成注解。这里统一改成按「最具体方法 → 声明类」反射解析：
     * 两种写法行为一致，也不再依赖绑定语义（{@code myLog} 理论上仍可能为 null，下游全部按可空处理）。
     */
    @Around("@annotation(com.campusflow.service.aspect.MyLog) || @within(com.campusflow.service.aspect.MyLog)")
    public Object around(ProceedingJoinPoint joinPoint) throws Throwable {
        MyLog myLog = resolveMyLog(joinPoint);
        Object returnValue = null;
        Throwable thrown = null;
        try {
            returnValue = joinPoint.proceed();
            return returnValue;
        } catch (Throwable businessFailure) {
            thrown = businessFailure;
            throw businessFailure;
        } finally {
            try {
                // 🔴 冻结现场必须在<b>请求线程</b>：UserContext/RequestContextHolder 是 ThreadLocal、
                // request 之后会被回收、joinPoint 出了方法就不该再碰。详见 AuditLogRecord 的类注释。
                auditLogWriter.write(captureAuditRecord(joinPoint, myLog, returnValue, thrown));
            } catch (Throwable auditFailure) {
                // 审计是旁路：吞掉，但级别给 error，别让它静默消失。
                // ⚠️ 注意用 Throwable 而不是 Exception：OutOfMemory / 栈溢出 也不能反过来吃掉业务结果。
                // 这里只剩「抓现场 + 投递」的失败（落库失败在 AuditLogWriter 内部自己兜）。
                log.error("[audit] 审计任务投递失败，本次操作未留痕: action={}, method={}",
                        actionOf(myLog, joinPoint), joinPoint.getSignature().toShortString(), auditFailure);
            }
        }
    }

    /** 方法上的 {@code @MyLog} 优先，没有才退到声明类上的（顺序与 AspectJ「取最具体」一致）。 */
    private static MyLog resolveMyLog(ProceedingJoinPoint joinPoint) {
        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        Method method = signature.getMethod();
        Object target = joinPoint.getTarget();
        if (target != null) {
            // JDK 动态代理下 signature 拿到的是接口方法，注解在实现类上 → 必须映射到最具体方法
            method = AopUtils.getMostSpecificMethod(method, target.getClass());
        }
        MyLog onMethod = AnnotatedElementUtils.findMergedAnnotation(method, MyLog.class);
        return onMethod != null ? onMethod
                : AnnotatedElementUtils.findMergedAnnotation(signature.getDeclaringType(), MyLog.class);
    }

    /**
     * 在请求线程上把现场冻结成一行 {@link AuditLogRecord}。
     *
     * <p>除了 {@code operator_role}（要回查库，交给异步线程），其余列这里全部写完 —— 包括 JSON 快照，
     * 于是交给异步线程的对象里只剩 String，无任何共享业务对象。
     */
    private AuditLogRecord captureAuditRecord(ProceedingJoinPoint joinPoint, MyLog myLog,
                                              Object returnValue, Throwable thrown) {
        boolean success = isSuccess(returnValue, thrown);
        Object[] args = joinPoint.getArgs();
        Object data = dataOf(returnValue);
        Long operatorId = resolveOperatorId(returnValue, args);
        HttpServletRequest request = currentRequest();

        AuditLogs row = new AuditLogs()
                .setRequestId(resolveRequestId(request))
                .setOperatorUserId(operatorId)
                .setAction(truncate(actionOf(myLog, joinPoint), MAX_ACTION_LENGTH))
                .setResourceType(truncate(resolveResourceType(myLog, joinPoint), MAX_RESOURCE_TYPE_LENGTH))
                .setResourceId(AuditContext.getResourceId())
                .setResult(success ? RESULT_SUCCESS : RESULT_FAILURE)
                .setIpAddress(resolveIp(request))
                .setUserAgent(truncate(request == null ? null : request.getHeader("User-Agent"),
                        MAX_USER_AGENT_LENGTH))
                .setBeforeData(argsToJson(args))
                .setAfterData(success ? toJsonSafely(data) : null)
                .setErrorMessage(truncate(errorMessageOf(returnValue, thrown), MAX_ERROR_LENGTH));
        // created_at 一律留空：交给库里的 DEFAULT CURRENT_TIMESTAMP(3)，
        // 免得应用机器时钟漂移写进审计（MyBatis-Plus 默认 NOT_NULL 策略会跳过 null 字段，DB 默认值生效）。
        //
        // operator_role 这里<b>故意不写</b>：它需要查库，是本次异步化要挪走的两件 I/O 之一。
        // 只把「返回体里读到的角色」作为提示传下去（登录能读到，带 token 的常规接口读不到 → 回查）。
        return new AuditLogRecord(row, asString(property(nestedUser(returnValue), "role")));
    }

    // ------------------------------------------------------------------ action / resource_type

    private static String actionOf(MyLog myLog, ProceedingJoinPoint joinPoint) {
        String verb = verbOf(joinPoint.getSignature().getName());
        String resourceType = resourceTypeOf(myLog, joinPoint);
        if (resourceType == null) {
            return verb;
        }
        return resourceType + "." + verb;
    }

    private static String resourceTypeOf(MyLog myLog, ProceedingJoinPoint joinPoint) {
        String declared = myLog == null ? null : trimToNull(myLog.value());
        if (declared != null) {
            return declared;
        }
        // 注解没写 value 时的兜底：拿实现类名去掉常见后缀，UsersServiceImpl → users。
        // resource_type 是 NOT NULL，绝不能让这一列空着。
        String name = joinPoint.getSignature().getDeclaringType().getSimpleName();
        for (String suffix : new String[]{"ServiceImpl", "Controller", "Service", "Impl"}) {
            if (name.endsWith(suffix) && name.length() > suffix.length()) {
                name = name.substring(0, name.length() - suffix.length());
                break;
            }
        }
        return name.toLowerCase(Locale.ROOT);
    }

    private static String verbOf(String methodName) {
        if (methodName == null || methodName.isBlank()) {
            return "unknown";
        }
        String lower = methodName.toLowerCase(Locale.ROOT);
        for (String verb : VERBS_LONGEST_FIRST) {
            if (lower.startsWith(verb)) {
                return VERB_ALIAS.getOrDefault(verb, verb);
            }
        }
        return methodName;
    }

    // ------------------------------------------------------------------ 操作人与结果

    private static boolean isSuccess(Object returnValue, Throwable thrown) {
        if (thrown != null) {
            return false;
        }
        // ⚠️ 本工程的失败走的是「HTTP 200 + body.code != 0」（GlobalExceptionHandler 的既有约定），
        // 所以不能只看有没有抛异常 —— 登录密码错就是 Result.failure(401)，必须记成 failure。
        if (returnValue instanceof Result<?> result) {
            return result.getCode() == 0;
        }
        return true;
    }

    private static String errorMessageOf(Object returnValue, Throwable thrown) {
        if (thrown != null) {
            String message = thrown.getMessage();
            String prefix = thrown.getClass().getSimpleName();
            return (message == null || message.isBlank()) ? prefix : prefix + ": " + message;
        }
        if (returnValue instanceof Result<?> result && result.getCode() != 0) {
            return result.getMessage();
        }
        return null;
    }

    private static Long resolveOperatorId(Object returnValue, Object[] args) {
        Long fromContext = UserContext.getUserId();
        if (fromContext != null) {
            return fromContext;
        }
        Long fromReturnValue = asLong(property(nestedUser(returnValue), "id"));
        if (fromReturnValue != null) {
            return fromReturnValue;
        }
        for (Object arg : args) {
            Long fromArg = firstIdOf(arg, "userId", "operatorId");
            if (fromArg != null) {
                return fromArg;
            }
        }
        return null;
    }

    /** 返回体里的操作人对象；登录时是 {@code LoginVo.user}。 */
    private static Object nestedUser(Object returnValue) {
        Object data = dataOf(returnValue);
        for (String property : new String[]{"user", "currentUser", "operator"}) {
            Object candidate = property(data, property);
            if (candidate != null) {
                return candidate;
            }
        }
        return null;
    }

    /**
     * 资源类型：优先取业务在 {@link AuditContext} 里的显式声明，未声明才回退到注解的 {@code value}。
     *
     * <p>做成"可覆盖"是为了让 {@code resource_type} 与 {@code resource_id} 能出自<b>同一个声明点</b>
     * （{@link AuditContext#setResource(String, Long)}）—— 原先两者分别来自注解和反射猜，
     * 中间没有任何一致性校验，于是 {@code application:18} 这种"类型对、id 却是别人"的组合能长期潜伏。
     */
    private static String resolveResourceType(MyLog myLog, ProceedingJoinPoint joinPoint) {
        String declared = AuditContext.getResourceType();
        if (declared != null && !declared.isBlank()) {
            return declared;
        }
        return resourceTypeOf(myLog, joinPoint);
    }

    private static Object dataOf(Object returnValue) {
        if (returnValue instanceof Result<?> result) {
            return result.getData();
        }
        return returnValue;
    }

    // ------------------------------------------------------------------ 现场信息

    private static HttpServletRequest currentRequest() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        // 非 Web 调用（例如 xxl-job 里的方法标了 @MyLog）拿不到 request：其余列照写，ip/ua 留空。
        if (attributes instanceof ServletRequestAttributes servletAttributes) {
            return servletAttributes.getRequest();
        }
        return null;
    }

    private static String resolveRequestId(HttpServletRequest request) {
        if (request != null) {
            String fromHeader = trimToNull(request.getHeader(REQUEST_ID_HEADER));
            if (fromHeader != null) {
                return truncate(fromHeader, MAX_REQUEST_ID_LENGTH);
            }
            Object existing = request.getAttribute(REQUEST_ID_ATTRIBUTE);
            if (existing instanceof String cached && !cached.isBlank()) {
                return truncate(cached, MAX_REQUEST_ID_LENGTH);
            }
            String generated = REQUEST_ID_PREFIX + UUID.randomUUID().toString().replace("-", "");
            request.setAttribute(REQUEST_ID_ATTRIBUTE, generated);
            return generated;
        }
        return REQUEST_ID_PREFIX + UUID.randomUUID().toString().replace("-", "");
    }

    private static String resolveIp(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        // nginx 在前面反代：X-Forwarded-For 是「最早的一跳在最前」，取第一段才是真实客户端。
        String ip = firstHop(request.getHeader("X-Forwarded-For"));
        if (ip == null) {
            ip = trimToNull(request.getHeader("X-Real-IP"));
        }
        if (ip == null) {
            ip = trimToNull(request.getRemoteAddr());
        }
        return truncate(ip, MAX_IP_LENGTH);
    }

    private static String firstHop(String forwardedFor) {
        if (forwardedFor == null || forwardedFor.isBlank()) {
            return null;
        }
        int comma = forwardedFor.indexOf(',');
        return trimToNull(comma < 0 ? forwardedFor : forwardedFor.substring(0, comma));
    }

    // ------------------------------------------------------------------ JSON：脱敏 + 限长

    private String argsToJson(Object[] args) {
        List<Object> loggable = new ArrayList<>();
        for (Object arg : args) {
            if (isLoggableArg(arg)) {
                loggable.add(arg);
            }
        }
        if (loggable.isEmpty()) {
            return null;
        }
        // 单个入参直接序列化成对象（{"account":"...","password":"***"}），多个则成数组。
        return toJsonSafely(loggable.size() == 1 ? loggable.get(0) : loggable);
    }

    /** 入参里的文件流/请求响应对象既没有审计价值，序列化还可能炸或撑爆列。 */
    private static boolean isLoggableArg(Object arg) {
        return arg != null
                && !(arg instanceof ServletRequest)
                && !(arg instanceof ServletResponse)
                && !(arg instanceof MultipartFile)
                && !(arg instanceof InputStream)
                && !(arg instanceof OutputStream)
                && !(arg instanceof File)
                && !(arg instanceof byte[])
                && !(arg instanceof Class)
                && !(arg instanceof ClassLoader);
    }

    private String toJsonSafely(Object value) {
        if (value == null) {
            return null;
        }
        try {
            JsonNode node = objectMapper.valueToTree(value);
            maskSensitive(node, 0);
            String json = objectMapper.writeValueAsString(node);
            if (json.length() <= MAX_JSON_LENGTH) {
                return json;
            }
            ObjectNode truncated = objectMapper.createObjectNode();
            truncated.put("_truncated", true);
            truncated.put("_originalLength", json.length());
            truncated.put("_preview", json.substring(0, Math.min(PREVIEW_LENGTH, json.length())));
            return objectMapper.writeValueAsString(truncated);
        } catch (Exception e) {
            // 序列化不出来的对象（自引用、无 getter 的复杂类型等）→ 这一列留空，但不影响其余列落库。
            log.debug("[audit] 数据快照序列化失败，该列留空: type={}", value.getClass().getName(), e);
            return null;
        }
    }

    /**
     * 递归把敏感字段的值替换成 {@code ***}。
     *
     * <p>改的是 {@link JsonNode} 树而不是字符串，所以替换后<b>必然还是合法 JSON</b>；
     * 先收集键名再改，避免边遍历边改。
     */
    private void maskSensitive(JsonNode node, int depth) {
        if (node == null) {
            return;
        }
        if (depth > MAX_MASK_DEPTH) {
            if (node instanceof ObjectNode objectNode) {
                objectNode.removeAll();
                objectNode.set("_depthLimit", TextNode.valueOf(MASK));
            } else if (node instanceof ArrayNode arrayNode) {
                arrayNode.removeAll();
            }
            return;
        }
        if (node instanceof ObjectNode objectNode) {
            List<String> names = new ArrayList<>();
            objectNode.fieldNames().forEachRemaining(names::add);
            for (String name : names) {
                if (isSensitiveKey(name)) {
                    objectNode.set(name, TextNode.valueOf(MASK));
                } else {
                    maskSensitive(objectNode.get(name), depth + 1);
                }
            }
        } else if (node instanceof ArrayNode arrayNode) {
            for (JsonNode element : arrayNode) {
                maskSensitive(element, depth + 1);
            }
        }
    }

    private static boolean isSensitiveKey(String key) {
        if (key == null) {
            return false;
        }
        String lower = key.toLowerCase(Locale.ROOT);
        for (String keyword : SENSITIVE_KEYWORDS) {
            if (lower.contains(keyword)) {
                return true;
            }
        }
        return false;
    }

    // ------------------------------------------------------------------ 反射小工具

    /** 取一个属性值；任何异常（没有 getter、反射被拒）都当「拿不到」，绝不上抛。 */
    private static Object property(Object target, String name) {
        if (target == null || name == null || name.isBlank() || target instanceof Class) {
            return null;
        }
        if (target instanceof Map<?, ?> map) {
            return map.get(name);
        }
        String capitalized = Character.toUpperCase(name.charAt(0)) + name.substring(1);
        Method getter = findNoArgMethod(target.getClass(), "get" + capitalized, "is" + capitalized);
        if (getter == null) {
            return null;
        }
        try {
            return getter.invoke(target);
        } catch (Exception e) {
            return null;
        }
    }

    private static Method findNoArgMethod(Class<?> type, String... names) {
        for (String name : names) {
            try {
                Method method = type.getMethod(name);
                if (method.getParameterCount() == 0) {
                    return method;
                }
            } catch (NoSuchMethodException ignored) {
                // 试下一个名字
            }
        }
        return null;
    }

    private static Long firstIdOf(Object target, String... properties) {
        for (String name : properties) {
            Long id = asLong(property(target, name));
            if (id != null) {
                return id;
            }
        }
        return null;
    }

    private static Long asLong(Object value) {
        if (value instanceof Number number) {
            return number.longValue();
        }
        if (value instanceof CharSequence text) {
            try {
                return Long.parseLong(text.toString().trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private static String asString(Object value) {
        return value instanceof CharSequence text ? trimToNull(text.toString()) : null;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** 按<b>字符数</b>截断（与 MySQL varchar 的计法一致）；截断会留一个省略号表示有省略。 */
    private static String truncate(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength - 1) + "…";
    }
}
