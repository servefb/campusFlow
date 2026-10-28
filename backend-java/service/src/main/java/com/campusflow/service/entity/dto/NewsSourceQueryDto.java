package com.campusflow.service.entity.dto;

import lombok.Data;

/**
 * {@code GET /news/admin/sources} 查询参数。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class NewsSourceQueryDto {

    /** 关键词：源名称 / 源地址。 */
    private String keyword;

    /** {@code active} / {@code paused}；{@code all} 或空表示不限。 */
    private String status;

    private Integer page;

    private Integer page_size;
}
