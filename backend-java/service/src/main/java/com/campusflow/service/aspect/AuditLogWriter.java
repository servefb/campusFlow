package com.campusflow.service.aspect;

import com.campusflow.common.constant.RoleConstant;
import com.campusflow.service.config.AsyncConfig;
import com.campusflow.service.entity.po.AuditLogs;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.service.IAuditLogsService;
import com.campusflow.service.service.IUsersService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import java.util.Set;

/**
 * 审计落库的<b>异步写入端</b>：接住 {@link LogAspect} 冻结好的 {@link AuditLogRecord}，
 * 在独立线程池里补齐 {@code operator_role} 并 INSERT。
 *
 * <h3>异步的边界画在哪</h3>
 * 请求线程只做「取不回来就算丢了」的采集（{@code UserContext}、request header、JSON 快照），
 * 剩下<b>两件真 I/O</b> 全在这边：
 * <ol>
 *   <li>{@code operator_role} 回查 —— 只有返回体里没带角色时才发这条 SELECT，
 *       而带 token 的常规接口正好都是这种（{@link LogAspect} 读不到身份）；
 *   <li>{@code audit_logs} 的 INSERT。</li>
 * </ol>
 * 原来是这两条一起压在请求线程上，高频接口下就是两个 RTT 白给。
 *
 * <h3>为什么是 @Async 而不是 MQ</h3>
 * RabbitMQ 在本工程是通的（{@code RabbitMqConfig} 给文件扫描用），用 MQ 能多拿到「进程重启不丢」。
 * 但代价是：多一条队列/交换机声明、多一个消费者、broker 挂了审计同样丢（除非再做 outbox 表）。
 * 审计是旁路数据，值不了这个复杂度 —— 所以这里选 {@code @Async} + <b>有界队列 + 排队失败就退回调用线程</b>
 * （见 {@link AsyncConfig#auditLogExecutor}）。真需要跨重启不丢，再往 MQ 挪，切点只有这一个类。
 *
 * <p>⚠️ 无论走哪条路，<b>异常都不能逃出去</b>：异步线程里的异常没有人接，
 * {@code @Async} 的 {@code void} 返回值意味着调用方永远看不到它，最后只会变成一行
 * {@code SimpleAsyncUncaughtExceptionHandler} 的默认堆栈。所以下面自己兜住并记 error。
 *
 * <h3>🔴 已知边界：尽力而为，写失败即丢行（已确认接受，非缺陷）</h3>
 * 当前的可靠性档位是 <b>best-effort</b>，不变式是「业务成功 <b>⇏</b> 审计有行」。会丢行的窗口：
 * <ol>
 *   <li>{@code INSERT} 失败（DB 不可用 / 连接池耗尽 / 死锁）→ 记 error 后丢行，<b>这是主路径</b>；</li>
 *   <li>停机过程中<b>新入队</b>的任务 → Spring 直接丢弃，不保证留下日志；</li>
 *   <li>进程被 {@code kill -9} / 断电 → 在途任务随进程一起消失（任何非事务方案都拦不住）。</li>
 * </ol>
 * 而以下几处<b>不会</b>丢行，只是降级或变慢：队列满退回调用线程同步执行；正常关停等队列写完；
 * 回查 {@code users.role} 失败只让 {@code operator_role} 留空。
 *
 * <p>要提升档位时，改动的落点<b>只在本类</b>（假若走 outbox，则需连同 {@link LogAspect} 的
 * 事务边界一起调整）。可选路径：进程内退避重试 → 失败落本地 jsonl + 启动/定时回灌 → outbox → MQ。
 *
 * <p>⚠️ <b>不要试图靠"把整行内容打进失败日志"来兜底</b>（曾尝试，已撤回）：日志会被塞进大批业务数据，
 * 体积暴涨、轮转加快、检索变差，等于把审计内容在日志系统里又存一份。失败日志<b>只承担定位职责</b>
 * （谁 / 对什么 / 做了什么 / 失败了），不承担恢复职责 —— 要"可恢复"就得往上走一档（重试 / 落盘回灌 / outbox）。
 *
 * @see AuditLogRecord 现场快照的跨线程约定
 */
@Slf4j
@Component
public class AuditLogWriter {

    /** {@code audit_logs.operator_role} 是 MySQL ENUM，白名单外的值写进去会整行插入失败。 */
    private static final Set<String> ALLOWED_OPERATOR_ROLES =
            Set.of(RoleConstant.ROLE_STUDENT, RoleConstant.ROLE_TEACHER, RoleConstant.ROLE_ADMIN);

    private final IAuditLogsService auditLogsService;

    /**
     * 🔴 这里同样<b>必须</b>用 {@link ObjectProvider}（或 {@code @Lazy}），
     * <b>不能直接注入 {@code IUsersService}</b> —— 与 {@link LogAspect} 里那个环是同一个：
     * 「本类 → IUsersService 代理 → 生成代理要 advisors → 要 LogAspect 实例
     * → LogAspect 要本类」转回自身，Spring Boot 2.6+ 默认禁止循环引用，
     * 会在<b>启动期</b>抛 {@code BeanCurrentlyInCreationException}。
     * {@code ObjectProvider} 把解析推迟到真正调用 {@code getIfAvailable()} 的时刻，环就断了。
     */
    private final ObjectProvider<IUsersService> usersServiceProvider;

    public AuditLogWriter(IAuditLogsService auditLogsService,
                          ObjectProvider<IUsersService> usersServiceProvider) {
        this.auditLogsService = auditLogsService;
        this.usersServiceProvider = usersServiceProvider;
    }

    /**
     * 在审计专用线程池里落库。调用方（{@link LogAspect}）不应期望它同步完成，
     * 也<b>不要</b>在依赖返回值的逻辑里调用它。
     */
    @Async(AsyncConfig.AUDIT_LOG_EXECUTOR)
    public void write(AuditLogRecord record) {
        AuditLogs row = record.row();
        try {
            row.setOperatorRole(resolveOperatorRole(row.getOperatorUserId(), record.operatorRoleHint()));
            auditLogsService.save(row);
        } catch (Throwable auditFailure) {
            // ⚠️ 用 Throwable 而不是 Exception：OutOfMemory / 栈溢出 也不能让它变成静默的未捕获异常。
            //
            // 🔴 这行日志是本次操作<b>唯一</b>的痕迹：@Async void 的异常调用方永远看不到，
            //    也轮不到 SimpleAsyncUncaughtExceptionHandler（已被本 catch 吃掉）。
            // ⚠️ 只打「定位信息」，<b>刻意不打 before/after 快照</b>：一旦把整行内容打进日志，
            //    日志就被塞进大批业务数据（体积暴涨、轮转变快、检索变差），等于把审计内容
            //    在日志系统里又存了一份 —— 代价高于收益。
            //    因此丢行是<b>净损失</b>：能定位到"谁在什么时候对什么做了什么、失败了"，
            //    但无法据此还原改动内容。这正是 best-effort 的应有之义，不是遗漏。
            log.error("[audit] 异步写入 audit_logs 失败，本次操作未留痕: action={}, operatorUserId={}, resource={}:{}",
                    row.getAction(), row.getOperatorUserId(), row.getResourceType(), row.getResourceId(),
                    auditFailure);
        }
    }

    /**
     * 确定 {@code operator_role}：返回体里带来的优先（登录就是这条），没有才回查库。
     *
     * <p>与改造前的行为<b>逐字一致</b>：hint 存在但不在白名单内时<b>不会</b>退回去查库 ——
     * 那不是"缺失"，是"来源本身给了个非法值"，回查只会用一个更权威的值把它盖过去，
     * 反而掩盖了上游数据问题。真正需要回查的只有 hint 为 null 这一种。
     */
    private String resolveOperatorRole(Long operatorUserId, String operatorRoleHint) {
        if (operatorRoleHint != null) {
            return whitelisted(operatorRoleHint);
        }
        if (operatorUserId == null) {
            return null;
        }
        return whitelisted(queryRoleFromDatabase(operatorUserId));
    }

    private String queryRoleFromDatabase(Long operatorUserId) {
        try {
            IUsersService usersService = usersServiceProvider.getIfAvailable();
            if (usersService == null) {
                return null;
            }
            Users user = usersService.getById(operatorUserId);
            return user == null ? null : user.getRole();
        } catch (Exception e) {
            log.warn("[audit] 回查 users.role 失败，本行 operator_role 留空: operatorUserId={}", operatorUserId, e);
            return null;
        }
    }

    /** {@code operator_role} 是 MySQL ENUM('student','teacher','admin')：白名单外一律留空，绝不硬写。 */
    private static String whitelisted(String role) {
        return role != null && ALLOWED_OPERATOR_ROLES.contains(role) ? role : null;
    }
}
