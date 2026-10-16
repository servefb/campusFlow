package com.campusflow.service.entity.vo;

import lombok.Data;

/**
 * {@code GET /admin/audit-logs/summary} —— 审计台账概览行四项读数。
 *
 * <h3>口径（每个数都要能对上页面文案，否则就是「有数字没含义」）</h3>
 * <table border="1">
 *   <caption>四项读数的定义</caption>
 *   <tr><th>字段</th><th>页面文案</th><th>口径</th></tr>
 *   <tr>
 *     <td>{@code today_events}</td><td>今日累计审计事件</td>
 *     <td>今日（东八区自然日 00:00 起）的 {@code audit_logs} 行数</td>
 *   </tr>
 *   <tr>
 *     <td>{@code today_events_delta}</td><td>环比小注</td>
 *     <td>与<b>昨日同期</b>（昨日 00:00 至此刻）的比值差：{@code (今日 − 昨日同期) / 昨日同期}。
 *         ⚠️ 分母为 0 时返回 {@code null}，前端渲染「—」。返回 0 会被读成「与昨日完全持平」，
 *         那是拿「没有可比对象」冒充了一个结论</td>
 *   </tr>
 *   <tr>
 *     <td>{@code high_risk_blocked}</td><td>高危阻断 / 鉴权失败</td>
 *     <td>近 7 天 {@code result='failure'} 的事件数（含鉴权失败、越权与执行失败）</td>
 *   </tr>
 *   <tr>
 *     <td>{@code auto_task_rate}</td><td>自动任务占比</td>
 *     <td>近 7 天 {@code operator_user_id IS NULL} 的事件占比 —— 没有操作人 = 由定时任务 /
 *         后台作业自动执行的动作。这是库里唯一能区分「人做的」与「系统做的」的事实来源</td>
 *   </tr>
 *   <tr>
 *     <td>{@code retention_days}</td><td>存储存续周期</td>
 *     <td>配置值（{@code campus-flow.audit.retention-days}）。它是**策略**不是测量值：
 *         审计表的清理由部署侧按这个天数做，接口如实回传配置，不编一个数字</td>
 *   </tr>
 * </table>
 *
 * <p>{@code total} = 全部审计事件总数（不限窗口），供页面做「当前筛选窗口 vs 全量」的对照。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class AuditSummaryVo {

    private long today_events;

    /** 与昨日同期的环比；昨日同期为 0 时是 {@code null}（前端「—」）。 */
    private Double today_events_delta;

    private long high_risk_blocked;

    /** 0~1；近 7 天没有任何事件时为 {@code null}（而不是 0）。 */
    private Double auto_task_rate;

    private int retention_days;

    private long total;
}
