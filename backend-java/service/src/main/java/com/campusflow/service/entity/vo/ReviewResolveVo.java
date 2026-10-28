package com.campusflow.service.entity.vo;

import lombok.Data;

import java.time.OffsetDateTime;

/**
 * {@code POST /admin/reviews/{id}/resolve} 的返回体。
 *
 * <p>管理端只读这四个字段（{@code services/metrics.ts} 里写死了返回类型的形状），
 * 用来在提交后把该行就地改成终态，不必重新拉整个队列。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class ReviewResolveVo {

    private Long id;

    /** 处置后的状态：{@code resolved}（通过 / 订正）或 {@code rejected}（驳回）。 */
    private String status;

    /** 本次处置动作：{@code approve / correct / reject}。 */
    private String action;

    private OffsetDateTime resolved_at;
}
