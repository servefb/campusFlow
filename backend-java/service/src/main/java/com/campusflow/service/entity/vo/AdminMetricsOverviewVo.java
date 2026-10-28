package com.campusflow.service.entity.vo;

import lombok.Data;

import java.time.OffsetDateTime;

/**
 * {@code GET /admin/metrics/overview} 的返回体 —— 区间概览读数（契约文档第 14 章）。
 *
 * <h3>2026-09-23 这一轮改了什么（这个接口此前<b>必然 500</b>）</h3>
 * 老实现是 {@code Map<String, Integer> getOverview()} 配一条
 * {@code select sum(elapsed_ms) as elapsedMs, count(me.role) as mesCount from messages
 * where me.role='user'}：
 * <ol>
 *   <li>{@code SUM()} 在 MySQL 里是 {@code DECIMAL}/{@code Long}，MyBatis 映射回
 *       {@code Map<String, Integer>} 时直接 {@code ClassCastException} →
 *       <b>HTTP 500</b>。管理端「系统观察」页在真机下整页指标全空；</li>
 *   <li>它只算提问行（{@code role='user'}），而提问行的 {@code elapsed_ms} 恒为 NULL，
 *       即使类型对得上也只会得到 NULL；</li>
 *   <li>四个率（引用命中率 / 好评率 / 自主解决率）在响应里<b>压根没有字段</b>，
 *       前端只能一直显示「—」。契约样例里写的 {@code citation_hit_rate}、
 *       {@code helpful_rate} 从未上过屏。</li>
 * </ol>
 *
 * <h3>⚠️ 数值字段一律可空，这是刻意的</h3>
 * {@code average_response_ms} 等<b>测量型</b>指标没有数据时必须回 {@code null}，
 * 让前端渲染「—」。回 0 会被读成「响应时长 0 毫秒」—— 一个看起来完美、实际是错的读数。
 * 只有 {@code question_count} / {@code human_review_pending} 这类<b>计数型</b>指标
 * 才允许是 0，因为「这一小时确实没人提问」是一个真实事实。
 * 这条规矩与 {@code MetricMeta.data_complete} 配套：{@code data_complete=false} 时
 * 前端会把整排读数置空。
 *
 * @see com.campusflow.service.support.MetricWindow
 * @see com.campusflow.service.controller.AdminMetricsController#overview(String)
 */
@Data
public class AdminMetricsOverviewVo {

    /** 规范化后的档位：{@code today / 7d / 30d}。不认识的档位在解析时已报 400，不会原样回显。 */
    private String range;

    /** 采样粒度，{@code today} 为 {@code hour}，其余为 {@code day} —— 与 {@code /trends} 同步。 */
    private String interval;

    /** 本次统计的执行时刻（东八区、精确到秒），不是任何一张表的 updated_at。 */
    private OffsetDateTime updated_at;

    /** 见类注释：本实现全部来自实时查询，恒为 {@code true}。 */
    private Boolean data_complete;

    private Metrics metrics;

    /**
     * 概览读数。
     *
     * <p>⚠️ 每个可空字段的注释都写明了「什么时候是 null」，改动口径前先读一遍 ——
     * 这些 null 不是偷懒没兜底，而是「没测到」与「测到 0」的区别。
     */
    @Data
    public static class Metrics {

        /** 区间内提问数（{@code role='user'} 的消息条数）。计数型，0 是真实值。 */
        private Long question_count;

        /**
         * 区间内回答的平均耗时（毫秒，对 {@code role='assistant'} 的 {@code elapsed_ms} 取均值）。
         * 区间内没有任何带耗时的回答时为 {@code null} → 前端「—」。
         */
        private Long average_response_ms;

        /**
         * 引用命中率 = 挂上至少一条引用的回答数 ÷ 有据可依（{@code grounded=1}）的回答数。
         *
         * <p>分母是 {@code grounded=1} 而不是全部回答：没检索到知识源的回答本来就不该带引用，
         * 算进分母会让这个率恒低且无法通过优化知识库提升。分母为 0 时为 {@code null}。
         */
        private Double citation_hit_rate;

        /** 好评率 = {@code helpful} 评价数 ÷ 区间内评价总数。区间内没有评价时为 {@code null}。 */
        private Double helpful_rate;

        /**
         * AI 自主解决率 = 未被人工复核分流的回答数 ÷ 区间内回答总数。
         * 区间内没有回答时为 {@code null}。
         */
        private Double auto_resolved_rate;

        /**
         * 当前待复核工单数（{@code content_reviews.status='pending'}）。
         *
         * <p>⚠️ <b>不随 range 变化</b>：它是瞬时积压量，不是流量。按区间筛它会让
         * 「切成 30 天」把积压量读成 300 件。
         */
        private Long human_review_pending;

        /**
         * 提问数环比：相对<b>等长的上一个窗口</b>的变化率（{@code 0.164} = +16.4%）。
         *
         * <p>「今日」的上一窗口是「昨日 00:00 → 昨日此刻」，不是昨日一整天 ——
         * 否则每天早上都显示暴跌。
         * 上一窗口提问数为 0 时为 {@code null}（除法无意义）→ 前端不渲染角标。
         */
        private Double question_count_delta;

        /** 平均响应时长的环比，口径同上。上一窗口没测到耗时时为 {@code null}。 */
        private Double average_response_ms_delta;
    }
}
