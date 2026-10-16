package com.campusflow.service.entity.dto;

import lombok.Data;

/**
 * {@code PATCH /news/admin/news/{id}} —— 改稿、上下线、置顶。
 *
 * <p>所有字段可选：{@code null} = 不改。上下线就是只传 {@code status}：
 * {@code published}（上线，服务端补 {@code published_at}）/ {@code offline}（下线，保留历史时间）。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class NewsAdminUpdateDto {

    private String title;

    private String summary;

    private String content;

    private String category;

    private String visibility;

    private String cover_file_id;

    private String status;

    private Boolean is_spotlight;

    private String deadline_at;
}
