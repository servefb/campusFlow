package com.campusflow.service.entity.vo;

import lombok.Data;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

/**
 * {@code GET /admin/reviews} / {@code GET /admin/reviews/{id}} 的一条工单。
 *
 * <h3>字段名为什么是 snake_case</h3>
 * 管理端 {@code types/api.ts} 的 {@code ReviewItem} 就长这样
 * （{@code message_id} / {@code reason_label} / {@code asker_account} …），
 * 换一个命名风格就是整块读不出来。
 *
 * <h3>⚠️ 后端为什么替前端译了 {@code reason_label}</h3>
 * {@code reason} 是 7 个固定枚举值（{@code low_confidence / policy_conflict / …}），
 * 直接上屏就是英文下划线串。这里的译名是<b>闭合枚举的展示层映射</b>，
 * 与审计日志那套「后端只给原始枚举、中文由前端译」的做法不冲突 ——
 * 那边的前端有 {@code normalizeAuditLog()} 专门做这件事，
 * 而复盘队列没有对应的归一化层，页面直接写的是 {@code item.reason_label ?? item.reason}。
 * 前端保留自己的兜底映射即可，两处映射的是同一张闭合表，不会漂移。
 *
 * <h3>⚠️ 给不出来的字段保持 null，不用兜底文案填</h3>
 * <ul>
 *   <li>{@code topic}（问题聚类主题）—— 库里没有这个字段，AI 服务也没写过；</li>
 *   <li>{@code asker_account} / {@code asker_department} —— 要走
 *       {@code content_reviews.conversation_id → conversations.user_id → users}，
 *       工单没记 {@code conversation_id} 或会话已删时为 null，页面显示「—」；</li>
 *   <li>{@code citations} —— 只有详情接口会填（列表页不渲染引用，省掉 N+1 查询）。</li>
 * </ul>
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class ReviewItemVo {

    private Long id;

    /** 被复核的 assistant 消息 id。 */
    private Long message_id;

    private Long conversation_id;

    /** 原始枚举，如 {@code policy_conflict}。 */
    private String reason;

    /** 中文译名，如「政策口径冲突」。 */
    private String reason_label;

    /** {@code high / medium / low}。 */
    private String risk;

    /** 开单时的置信度，0~1。 */
    private Double confidence;

    /** 用户原问题（开单时快照）。 */
    private String question;

    private String answer;

    /** {@code pending / resolved / rejected}。 */
    private String status;

    /** 开单来源 Agent 的中文名（由 {@code agent_key} 反查 {@code agents.name}）；查不到为 null。 */
    private String agent_name;

    /** 提问人账号。取不到为 null。 */
    private String asker_account;

    /** 提问人所属院系。取不到为 null。 */
    private String asker_department;

    /** 该回答的引用列表，只在实际用得到时填（详情接口）。 */
    private List<Map<String, Object>> citations;

    private String model;

    /** 问题聚类主题 —— 库中无此数据，恒为 null。 */
    private String topic;

    private OffsetDateTime created_at;
}
