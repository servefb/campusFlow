package com.campusflow.service.entity.dto;

import lombok.Data;

import java.util.List;

/**
 * {@code POST /admin/reviews/{id}/resolve} 的请求体（契约文档第 14 章）。
 *
 * <p>与请求头 {@code Idempotency-Key} 配合：管理端处理工单时会带上它，
 * 用来防止网络重试把同一张单处置两次。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class ReviewResolveDto {

    /** 处置动作：{@code approve}（通过） / {@code correct}（订正后通过） / {@code reject}（驳回）。 */
    private String action;

    /** 订正后的回答正文。{@code action=correct} 时必填，其余动作忽略。 */
    private String corrected_answer;

    /** 订正保留的引用 id 列表（可空）。 */
    private List<String> citation_ids;

    /** 处置备注（可空）。 */
    private String comment;
}
