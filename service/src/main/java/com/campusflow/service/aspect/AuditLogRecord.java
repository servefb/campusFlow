package com.campusflow.service.aspect;

import com.campusflow.service.entity.po.AuditLogs;

/**
 * 一条待落库的审计行的<b>现场快照</b>：跨线程传递的载体。
 *
 * <h3>为什么需要这个类（而不是直接把 joinPoint 丢给异步线程）</h3>
 * 审计落库改异步后，最容易踩的坑是「在异步线程里再去看现场」——那时现场已经没了：
 * <ul>
 *   <li>{@code UserContext} 是 {@link ThreadLocal} → 异步线程读到 {@code null}；</li>
 *   <li>{@code RequestContextHolder} 同理，且 {@code HttpServletRequest} 在请求结束后会被容器回收，
 *       留着引用去拿 header 属于未定义行为；</li>
 *   <li>{@code ProceedingJoinPoint} 出了被拦方法就不该再调用（{@code getArgs()} 返回的是<b>活引用</b>，
 *       不是副本）。</li>
 * </ul>
 * 所以约定：<b>凡是"离开请求线程就取不到"的东西，一律在请求线程上先冻结进本对象</b>；
 * 异步线程只负责"还需要 I/O 才能算出来的东西"。目前后者只有两件：
 * {@code operator_role}（要回查 {@code users.role}）和 INSERT 本身。
 *
 * <h3>{@code row} 的跨线程约定（重要）</h3>
 * {@code row} 是 MyBatis-Plus 的实体，本身可变——这里靠两条纪律保证安全：
 * <ol>
 *   <li>它在请求线程上被<b>构造并赋完值</b>（除 {@code operator_role}），交出去之后请求线程<b>绝不再碰它</b>；</li>
 *   <li>跨线程可见性由「提交到 Executor」这件事建立的 happens-before 保证，
 *       不需要额外的 {@code synchronized}/{@code volatile}。</li>
 * </ol>
 * 因此它虽然是个可变对象，实际生命周期是「单次移交、单线程写」。若哪天要多线程共享同一行，
 * 这个前提就破了，那时应改成全字段不可变。
 *
 * <h3>{@code operatorRoleHint} 为什么要单独放</h3>
 * 登录能从返回体 {@code LoginVo.user.role} 直接拿到身份；带 token 的常规接口则拿不到，
 * 必须回查库。这里只传递「返回体里读到的那个角色」，<b>是不是合法值由写入方判断</b>——
 * 白名单校验只留一份，避免切面和写入方各写一遍、日后改一处漏一处。
 *
 * @param row               已赋值的审计行，仅 {@code operator_role} 可能待补
 * @param operatorRoleHint  返回体里读到的操作人角色；{@code null} 表示"返回体里没有，需要回查"
 * @see AuditLogWriter
 */
public record AuditLogRecord(AuditLogs row, String operatorRoleHint) {
}
