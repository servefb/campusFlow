package com.campusflow.service.entity.vo;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Data;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * {@code GET /admin/metrics/trends} 的返回体 —— 逐桶采样的使用趋势（契约文档第 14 章）。
 *
 * <h3>为什么空桶也要返回</h3>
 * 折线图的横轴是<b>等距</b>的：跳过没有数据的桶，会把 09-11 和 09-14 画成两个相邻点，
 * 看上去像「连着三天都在提问」。所以窗口内的桶一个不少地返回，
 * 空桶的 {@code question_count} 是<b>真实的 0</b>（那一小时确实没人问）——
 * 计数为 0 是事实，比率缺测才是「不知道」。
 *
 * <h3>⚠️ 三条线的可得性</h3>
 * {@code ai_resolved} / {@code human_routed} 是「是否被人工复核分流」的推论。
 * 整个窗口<b>一个复核工单都没有</b>时这两个字段<b>整体不返回</b>（null）：
 * 那种情况下它们只能是「全部自主解决」，画出来是一条贴地 0 的红虚线加一条和总量重合的黑线，
 * 比单线更容易让人误读。管理端的图表已按「缺字段则退化成单线」实现，见
 * {@code components/UsageTrendChart.tsx}。
 *
 * @see com.campusflow.service.support.MetricWindow
 * @see com.campusflow.service.controller.AdminMetricsController#trends(String, String)
 */
@Data
public class AdminMetricsTrendsVo {

    /** {@code today / 7d / 30d}。 */
    private String range;

    /** {@code hour / day}。请求里带的 interval 只用于校验，实际粒度由 range 决定（见 MetricWindow）。 */
    private String interval;

    private OffsetDateTime updated_at;

    /** 恒为 {@code true}，见 {@code AdminMetricsOverviewVo} 的说明。 */
    private Boolean data_complete;

    private List<Item> items;

    /**
     * 一个采样桶。
     *
     * <p>🔴 {@link JsonInclude.Include#NON_NULL} <b>不是省流量，是契约的一部分</b>：
     * 管理端按 `point.ai_resolved !== undefined` 判断「有没有分流数据」，
     * 决定趋势图画一条线还是三条线。若这里把 null 序列化成 `"ai_resolved": null`，
     * 判空就会通过，于是页面会画出一条贴着 0 的「人工复核分流」虚线 ——
     * 一条由 null 伪造出来的数据线。缺失就是缺失，键不出现。
     */
    @Data
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Item {

        /** 桶标签：小时桶形如 {@code 08:00}，天桶形如 {@code 09-14}（直接上横轴）。 */
        private String time;

        /** 桶内提问数。计数型，0 表示这一格确实没人问。 */
        private long question_count;

        /**
         * 桶内回答的平均耗时（毫秒）。该桶没有任何带耗时的回答时为 {@code null}。
         *
         * <p>⚠️ 契约样例把它写成必填数字。本实现给可空 —— 用 0 顶替会在图上画出一个
         * 「响应时长 0 秒」的谷底，而事实上那一格根本没测到。
         */
        private Long average_response_ms;

        /** 桶内未被人工复核分流的回答数（仅在窗口内存在复核工单时才给）。 */
        private Integer ai_resolved;

        /** 桶内被人工复核分流的回答数（仅在窗口内存在复核工单时才给）。 */
        private Integer human_routed;
    }
}
