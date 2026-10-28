package com.campusflow.service.entity.vo;

import lombok.Data;

/**
 * {@code GET /news/admin/sources} 列表项（契约 A.7.9）。
 *
 * <p>{@code selector} 的映射见 {@code NewsSourceUpdateDto} 的注释：库里的
 * {@code sync_rule} 是 JSON，接口把它摊平成三个具名选择器。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class NewsSourceVo {

    private String id;

    private String name;

    private String base_url;

    /** {@code active} / {@code paused}。 */
    private String status;

    private Integer sync_interval_minutes;

    private String last_synced_at;

    /** 已配置的抓取归类；未配置时为 null（前端不展示，不编造）。 */
    private String category;

    /** {@code rss / html / api / manual}。 */
    private String source_type;

    private Selector selector;

    /** 最近一次同步结果：{@code pending / running / completed / failed / cancelled}；从未同步为 null。 */
    private String last_sync_status;

    /** 最近一次同步失败原因；成功或从未同步为 null。 */
    private String last_error;

    @Data
    public static class Selector {
        private String list;
        private String title;
        private String published_at;
    }
}
