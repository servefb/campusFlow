package com.campusflow.common.constant;

/**
 * {@code files.status} 的取值。
 *
 * <p>与 {@code 校园事务智能助手数据库设计.sql} 里的
 * {@code enum('pending','uploaded','scanning','ready','rejected','deleted')} 一一对应，
 * 改这里必须同步改 DDL 的 enum。
 *
 * <p>状态机是线性的，不要跳步、不要回退：
 * <pre>
 *   pending ──▶ uploaded ──▶ scanning ──▶ ready          （唯一可用态）
 *                              │
 *                              └──▶ rejected             （扫描/审核没通过，需重传）
 *   任意态 ──▶ deleted                                  （逻辑删除）
 * </pre>
 *
 * <p>🔴 业务接口在引用 {@code file_id} 之前<b>必须</b>校验它是 {@link #READY}，否则返 40900 状态冲突。
 *
 * <p>⚠️ {@link #UPLOADED} 与 {@link #SCANNING} 的区别不是措辞问题，是排障入口：
 * <ul>
 *   <li>{@link #UPLOADED} —— 还没被任何扫描器取走。长时间停在这里 = MQ 投递失败或消费者没起；</li>
 *   <li>{@link #SCANNING} —— 已经开扫，或扫了但没得出结论（扫描器不可用、审核转人工）。
 *       具体原因看 {@code files.scan_result.reason_code}。</li>
 * </ul>
 */
public interface FileConstant {

    /** 记录已建，字节还没落到对象存储。 */
    String PENDING = "pending";

    /** 字节已落对象存储、记录登记完成，排队等扫描。 */
    String UPLOADED = "uploaded";

    /** 正在扫（MIME / 病毒 / 内容审核），或扫了但没得出结论。 */
    String SCANNING = "scanning";

    /** 扫描通过 —— <b>唯一可以被业务引用的状态</b>。 */
    String READY = "ready";

    /** 扫描或内容审核没通过，原因在 {@code scan_result} 里，需重新上传。 */
    String REJECTED = "rejected";

    /** 逻辑删除（配合 {@code deleted_at}）。所有列表查询都应排除它。 */
    String DELETED = "deleted";
}
