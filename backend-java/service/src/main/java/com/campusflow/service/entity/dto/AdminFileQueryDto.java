package com.campusflow.service.entity.dto;

import lombok.Data;

/**
 * {@code GET /admin/files} 查询参数（文件审核台契约草案）。
 *
 * <p>管理端 {@code services/fileReview.ts} 发出的参数：
 * {@code state}（默认 {@code all}，为 all 时前端置 undefined）、
 * {@code purpose}（原值精确匹配，all 不筛）、{@code page}、{@code page_size}。
 *
 * @author JIA
 * @since 2026-10-15
 */
@Data
public class AdminFileQueryDto {

    /**
     * 派生审核态：{@code manual / scanning / ready / rejected / all}。
     * <p>库里没有这一列，由 {@code files.status + scan_result.reason_code} 派生（与前端
     * {@code fileReviewStateOf} 同源）；{@code all} 或不传表示不限。
     */
    private String state;

    /** {@code files.purpose} 原值精确匹配（knowledge_doc / task_material / avatar…）；{@code all} 或空表示不限。 */
    private String purpose;

    private Integer page;

    private Integer page_size;
}
