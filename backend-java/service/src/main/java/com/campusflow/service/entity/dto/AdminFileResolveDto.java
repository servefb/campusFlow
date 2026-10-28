package com.campusflow.service.entity.dto;

import lombok.Data;

/**
 * {@code POST /admin/files/{id}/resolve} 请求体（文件审核台契约草案）。
 *
 * <p>管理端 {@code services/fileReview.ts#resolveFileReview} 以 JSON body 发送，
 * 并在请求头带 {@code Idempotency-Key}（服务端仅记日志便于排查重放）。
 *
 * @author JIA
 * @since 2026-10-15
 */
@Data
public class AdminFileResolveDto {

    /** 处置动作：{@code approve} = 放行（→ ready）；{@code reject} = 阻断（→ rejected）。 */
    private String action;

    /** 处置备注，可选；写进 {@code scan_result.reason} 与 {@code scan_result.manual.comment}。 */
    private String comment;
}
