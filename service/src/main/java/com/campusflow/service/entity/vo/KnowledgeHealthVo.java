package com.campusflow.service.entity.vo;

import lombok.Data;

import java.time.OffsetDateTime;

/**
 * {@code GET /admin/metrics/knowledge-health} 的返回体 —— 知识库健康指标（契约文档 §A.9.4）。
 *
 * <h3>为什么字段名是 snake_case</h3>
 * 与 {@link FileMetaVo}、{@link PostFileVo} 一致，也是契约样例里的字面写法。
 * 管理端 {@code services/metrics.ts} 直接读 {@code data.fulltext_index.last_completed_at}、
 * {@code data.documents.failed}，改成驼峰会静默取到 undefined。
 *
 * <h3>⚠️ 与契约样例的两处差异（都是有意的，不是漏改）</h3>
 * <ol>
 *   <li>{@code documents} <b>比契约多 3 个键</b>：除了契约的
 *       {@code ready / processing / failed / offline}，还给了 {@code draft}、{@code archived}
 *       和 {@code total}（2026-10-15 又补了契约外的 {@code removed}，见 {@link Documents#removed}）。
 *       库里的 {@code knowledge_documents.status} 有 <b>6</b> 个枚举值，
 *       契约的 4 个桶容不下 —— 多给比硬合并安全（合并了就没人看得出「草稿被算进了下线」）。
 *       前端类型是 {@code Record<string, unknown>}，多几个键不会有副作用。</li>
 *   <li>{@code updated_at} 是<b>本次统计的执行时刻</b>，不是任何一张表的 {@code updated_at}
 *       最大值。契约称之为"统计截止时刻"，语义就是快照时间。</li>
 * </ol>
 *
 * <h3>⚠️ 这里没有 {@code vector} 块</h3>
 * 管理端还会读 {@code data.vector.engine / similarity / chunks / embedding_model}，
 * 但那块数据来自向量库（Milvus），归属 AI 服务，本服务没有事实来源。
 * 按「接口没有的字段一律不写、不编」的原则留空 —— 前端那几个位置会渲染成 {@code —}。
 * 要让它有值，得先补契约、再由 AI 服务提供。
 *
 * @see com.campusflow.service.controller.AdminMetricsController#knowledgeHealth()
 */
@Data
public class KnowledgeHealthVo {

    /**
     * 本次统计的执行时刻，格式 {@code 2026-09-04T15:55:00+08:00}（东八区、精确到秒）。
     *
     * <p>用 {@link OffsetDateTime} 而不是 {@code LocalDateTime}：契约样例带 {@code +08:00}
     * 偏移量，而 {@code LocalDateTime} 序列化出来没有时区，前端 `new Date()` 会按浏览器本地时区
     * 解释 —— 跨时区打开看板就偏了。
     */
    private OffsetDateTime updated_at;

    /**
     * 这份数据是否完整。为 {@code false} 时<b>前端不得把缺失值显示成真实的 0</b>（契约第 14 章硬规定），
     * 管理端已按此约定渲染 {@code —}。
     *
     * <p>本实现四个板块全部来自实时查询，所以恒定 {@code true}。保留该字段一是契约要求，
     * 二是将来若有板块需要降级（例如向量指标依赖的外部服务不可用）时可以直接置 {@code false}，
     * 不必再改响应结构。
     */
    private Boolean data_complete;

    /** 文档状态计数 —— 见类注释第 1 条，比契约多 3 个键；{@code removed} 为契约外补充。 */
    private Documents documents;

    /** 全文检索索引的覆盖情况。 */
    private FulltextIndex fulltext_index;

    /** 待处理的文档内容冲突数（{@code knowledge_conflicts.status = 'pending'}）。 */
    private Long pending_conflicts;

    /** 文档状态计数。六个桶相加等于 {@link #total}。 */
    @Data
    public static class Documents {

        /** 已就绪、可被检索。 */
        private long ready;

        /** 正在跑解析 / 切片 / 索引流水线。 */
        private long processing;

        /** 处理失败，需人工介入（可能要重试作业）。 */
        private long failed;

        /** 人工下线，不再被检索。 */
        private long offline;

        /** 已建档但还没开始跑流水线（契约外的补充桶）。 */
        private long draft;

        /** 已归档（契约外的补充桶）—— 与 {@code offline} 分开，两者含义不同。 */
        private long archived;

        /**
         * 已移出知识库的文档数（契约外的补充桶，2026-10-15 补，页签徽章用）。
         *
         * <p>🔴 判据 = {@code deleted_at IS NOT NULL}（软删）。status 枚举里<b>没有</b>
         * {@code 'removed'}，移出由 AI 服务打软删戳、status 保持原值，所以这个桶
         * 与上面六个状态桶<b>互斥</b>：六桶之和 = {@link #total}（未软删总数），
         * removed 不计入 total。
         */
        private long removed;

        /** 未软删的文档总数 = 以上六个状态桶之和（不含 removed），供前端做一致性校验。 */
        private long total;
    }

    /** 全文检索索引覆盖情况。口径见 {@code AdminMetricsMapper} 类注释第 4 条。 */
    @Data
    public static class FulltextIndex {

        /** 属于 {@code ready} 文档的当前版本切片数 —— 这些是真正可被检索到的。 */
        private long indexed_sections;

        /**
         * 属于 {@code draft / processing} 文档的当前版本切片数 —— 这些还没就绪，排队等着。
         *
         * <p>不含 {@code failed / offline / archived} 文档的切片：它们不会自动变成可检索。
         */
        private long pending_sections;

        /**
         * 最近一次「全文索引」阶段跑完的时刻。一次都没跑完过时为 {@code null}（前端渲染 {@code —}）。
         */
        private OffsetDateTime last_completed_at;
    }
}
