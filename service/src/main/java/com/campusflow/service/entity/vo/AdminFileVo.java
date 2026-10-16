package com.campusflow.service.entity.vo;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.Data;

import java.time.OffsetDateTime;

/**
 * {@code GET /admin/files} 列表项（文件审核台契约草案）。
 *
 * <p>字段与管理端 {@code FileReviewItem}（{@code types/api.ts}）一一对应。
 * {@code scan_result} 是 json 列的<b>原样解析结果</b>（不重映射、不挑字段），
 * 前端靠它自行派生审核态（{@code fileReviewStateOf}）并展示各链路步骤；
 * 列为空或不是合法 JSON 时回 {@code null}（前端类型即 {@code FileScanResult | null}）。
 *
 * @author JIA
 * @since 2026-10-15
 */
@Data
public class AdminFileVo {

    private Long id;

    private Long owner_id;

    private String purpose;

    private String original_name;

    private String content_type;

    private Long size_bytes;

    private String sha256;

    /** {@code files.status} 原值：uploaded / scanning / ready / rejected。 */
    private String status;

    /** {@code files.scan_result} 原样（解析为 JSON 对象）；可能为 null。 */
    private JsonNode scan_result;

    private OffsetDateTime uploaded_at;

    private OffsetDateTime updated_at;
}
