package com.campusflow.common.context;

import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

/**
 * 审计上下文 —— 让业务方法<b>显式声明</b>「本次操作的对象是谁」。
 *
 * <h2>为什么需要它</h2>
 * 审计表的 {@code resource_id} 原先由切面靠反射猜（按属性名找 {@code id} / {@code userId}）。
 * 反射拿不到任何业务语义，实测三种常见接口形态<b>全部取错</b>：返回体里的 {@code id} 是申请人
 * 而不是申请单、容器 VO 里的 {@code user} 是发起人而不是任务、两个入参都带 id 时主体由
 * <b>参数顺序</b>决定。而"记错"比"留空"危险得多 —— 留空是诚实的缺失，
 * 记错是一行看起来完全合法的假数据。
 *
 * <h2>载体为什么是请求作用域而不是 ThreadLocal</h2>
 * 业务 id 是<b>请求级</b>的数据，{@link ThreadLocal} 却是<b>线程级</b>的容器 —— 存进去就等于
 * 自愿背上"用完必须清"的义务，而义务总有漏掉的一天：{@link TokenContext} 就是现成反例
 * （{@code JwtInterceptor#preHandle} 里 {@code setToken} 之后 return false 的两条路径，
 * {@code afterCompletion} 不会被调用 → 脏值留在复用线程上，被下一个请求读到）。
 * 请求作用域的 attribute 随请求一起销毁，<b>不需要任何清理代码，结构上不可能串号</b>。
 *
 * <p>实现上刻意只用 {@link RequestAttributes} 而不碰 {@code HttpServletRequest}：
 * 语义一样（{@code SCOPE_REQUEST} 落到 servlet 上就是 {@code request.setAttribute}），
 * 但不必让 common 模块依赖 servlet-api。
 *
 * <h2>用法</h2>
 * <pre>{@code
 * @MyLog(value = "task", description = "查看任务详情")
 * public Result detail(Long taskId) {
 *     AuditContext.setResource(taskId);      // 只声明 id，resource_type 仍取注解的 value
 *     ...
 * }
 * }</pre>
 * 需要连类型一起声明时用 {@link #setResource(String, Long)}：它让 {@code resource_type} 与
 * {@code resource_id} 出自<b>同一个声明点</b>，避免两列互相矛盾（注解写 task、id 却是别人的）。
 *
 * <h2>边界</h2>
 * <ul>
 *   <li>只在 HTTP 请求线程上有效。非 HTTP 入口（定时任务 / MQ 消费者）静默忽略，
 *       此时 {@link #getResourceId()} 返回 {@code null} → 审计记空，属预期（宁缺勿错）。</li>
 *   <li><b>没声明就记空，不会自动兜底</b>：切面已不再猜。新增 {@code @MyLog} 接口时
 *       请顺手声明一次，否则这一列是空的。</li>
 * </ul>
 *
 * @see com.campusflow.service.aspect.LogAspect 消费方
 */
public final class AuditContext {

    /** attribute 键名，带前缀避免与业务自己的 attribute 撞名。 */
    private static final String ATTR_RESOURCE_ID = "campus-flow.audit.resourceId";
    private static final String ATTR_RESOURCE_TYPE = "campus-flow.audit.resourceType";

    private AuditContext() {
    }

    /**
     * 声明本次操作的对象 id；{@code resource_type} 仍取 {@code @MyLog.value}。
     *
     * @param resourceId 业务对象主键；传 {@code null} 等价于清除声明
     */
    public static void setResource(Long resourceId) {
        setAttribute(ATTR_RESOURCE_ID, resourceId);
    }

    /**
     * 同时声明对象类型与 id。注解的 {@code value} 会被覆盖，
     * 从而保证 {@code resource_type} / {@code resource_id} 来自同一个声明点。
     *
     * @param resourceType 对象类型（{@code task} / {@code application} / {@code user} …）
     * @param resourceId   业务对象主键
     */
    public static void setResource(String resourceType, Long resourceId) {
        setAttribute(ATTR_RESOURCE_TYPE, resourceType);
        setAttribute(ATTR_RESOURCE_ID, resourceId);
    }

    /**
     * @return 本次请求声明的对象 id；未声明、或不在请求线程上时为 {@code null}
     */
    public static Long getResourceId() {
        Object value = getAttribute(ATTR_RESOURCE_ID);
        return value instanceof Long id ? id : null;
    }

    /**
     * @return 本次请求声明的对象类型；未声明时为 {@code null}（消费方据此决定是否回退到注解）
     */
    public static String getResourceType() {
        Object value = getAttribute(ATTR_RESOURCE_TYPE);
        return value instanceof String type ? type : null;
    }

    private static void setAttribute(String name, Object value) {
        RequestAttributes attributes = currentAttributes();
        if (attributes == null) {
            return;
        }
        attributes.setAttribute(name, value, RequestAttributes.SCOPE_REQUEST);
    }

    private static Object getAttribute(String name) {
        RequestAttributes attributes = currentAttributes();
        return attributes == null ? null : attributes.getAttribute(name, RequestAttributes.SCOPE_REQUEST);
    }

    /**
     * 取当前请求的 attribute 容器；不在请求线程上（定时任务 / MQ / 异步线程）返回 {@code null}。
     *
     * <p>用 {@code getRequestAttributes()} 而非 {@code currentRequestAttributes()}：
     * 后者在未绑定时会<b>抛异常</b>，而审计上下文在非 Web 场景下应当是"安静地没有"。
     */
    private static RequestAttributes currentAttributes() {
        return RequestContextHolder.getRequestAttributes();
    }
}
