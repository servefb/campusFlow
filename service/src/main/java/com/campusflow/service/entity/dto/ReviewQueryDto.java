package com.campusflow.service.entity.dto;

import lombok.Data;

/**
 * {@code GET /admin/reviews} 查询参数（契约文档第 14 章「人工复核」）。
 *
 * <p>管理端 {@code services/metrics.ts} 发出的参数：
 * {@code status}（默认 {@code pending}）、{@code risk}、{@code reason}、{@code page}、{@code page_size}。
 *
 * <p>⚠️ 前端在 {@code risk === 'all'} 时会把它置成 {@code undefined} 再发，
 * 但实现层仍然会把字符串 {@code all} 当成「不筛」摘掉 —— 两处都防，
 * 因为漏一处就会出现「点『全部』筛出 0 行」这种必现、且看不出原因的故障。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class ReviewQueryDto {

    /** 工单状态 {@code pending / resolved / rejected}；不传按 {@code pending} 处理（队列默认看未处置）。 */
    private String status;

    /** 风险等级 {@code high / medium / low}；{@code all} 或空表示不限。 */
    private String risk;

    /** 开单原因，见 {@code ContentReviews.reason}；{@code all} 或空表示不限。 */
    private String reason;

    private Integer page;

    private Integer page_size;
}
