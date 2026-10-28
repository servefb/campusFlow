package com.campusflow.service.entity.dto;

import lombok.Data;

/**
 * {@code PATCH /news/admin/sources/{id}} —— 编辑抓取规则。
 *
 * <h3>字段名为什么和库里不一样（有意为之）</h3>
 * 契约（文档 A.7.10 与数据表之间）做了重命名，本 DTO 按<b>接口命名</b>收参、由 service 映射回库列：
 * <pre>
 *   接口 status                  → news_sources.is_enabled   （active=1 / paused=0）
 *   接口 sync_interval_minutes   → news_sources.sync_rule.interval_minutes
 *   接口 category                → news_sources.sync_rule.category
 *   接口 selector.list           → news_sources.sync_rule.selector
 *   接口 selector.title          → news_sources.sync_rule.titleField
 *   接口 selector.published_at   → news_sources.sync_rule.dateField
 * </pre>
 * 映射集中在 {@code NewsSourcesServiceImpl}。之所以不把库列直接暴露成接口字段：
 * {@code sync_rule} 是 JSON、{@code is_enabled} 是布尔，直接暴露会让前端拿到
 * 与文档不符的形状（这正是《接口对接说明.md》里挂着的「待确认字段口径」那条）。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class NewsSourceUpdateDto {

    /** {@code active}（启用）或 {@code paused}（停用）；也接受 {@code enabled/disabled} 同义写法。 */
    private String status;

    private Integer sync_interval_minutes;

    /** 归入的新闻分类名（写入 sync_rule.category，仅作抓取归类用）。 */
    private String category;

    private Selector selector;

    @Data
    public static class Selector {

        /** 列表条目选择器，如 {@code .notice-list li}。 */
        private String list;

        /** 标题选择器，如 {@code a.text}。 */
        private String title;

        /** 发布时间选择器，如 {@code span.date}。 */
        private String published_at;
    }
}
