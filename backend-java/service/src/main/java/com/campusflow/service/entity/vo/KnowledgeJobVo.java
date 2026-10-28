package com.campusflow.service.entity.vo;

import lombok.Data;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * {@code GET /knowledge/admin/jobs} 的一条解析/索引作业（契约文档 11.2）。
 *
 * <h3>数据来自两张表</h3>
 * 作业主体在 {@code knowledge_jobs}，阶段明细在 {@code knowledge_job_steps}
 * （一个作业最多 4 步：{@code parsing → chunking → fulltext_indexing → publishing}）。
 * 明细<b>批量</b>取（一次 {@code IN}），不在循环里按 job 查 —— 一页 20 条就是 20 次单查。
 *
 * <h3>{@code error} 与 {@code error_code} 为什么都要</h3>
 * {@code error_code} 是给程序判断的稳定标识，{@code error_message} 是给人读的原因。
 * 页面直接显示后者；前者保留是为了将来按错误类型做聚合，不必回头再改契约。
 *
 * <h3>⚠️ 这个接口的「进度」是真的，不要拿它当摆设</h3>
 * {@code progress} / {@code current_stage} / {@code stages[].elapsed_ms} 都是
 * AI 服务写库的真实值（{@code ingest_service.run_ingest} 逐步更新）。
 * 前端如果只画一个假进度条，那还不如不画。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class KnowledgeJobVo {

    /** 作业 id（{@code knowledge_jobs.id}）。前端字段名就叫 {@code job_id}。 */
    private Long job_id;

    private Long document_id;

    /** 文档标题，取自 {@code knowledge_documents.title}；查不到为 null。 */
    private String document_title;

    /** 该作业处理的版本 id，可为 null。 */
    private Long version_id;

    /** 作业类型，如 {@code ingest}。库列 {@code varchar(32)} 无 CHECK，原样上屏。 */
    private String job_type;

    /** {@code pending / running / completed / failed / cancelled}（库为 enum）。 */
    private String status;

    /** {@code parsing / chunking / fulltext_indexing / publishing}，可为 null（尚未开始）。 */
    private String current_stage;

    /** 0~100。 */
    private Integer progress;

    private Integer attempt_count;

    private String error_code;

    /** 失败原因（{@code error_message}）。前端字段名是 {@code error}。 */
    private String error;

    private OffsetDateTime started_at;

    private OffsetDateTime completed_at;

    private OffsetDateTime created_at;

    /** 阶段明细，按库中顺序（parsing → … → publishing）。无明细时为空数组而不是 null。 */
    private List<Stage> stages;

    /**
     * 一个阶段。字段名与 {@code types/api.ts} 的 {@code KnowledgeJob['stages'][number]} 一致。
     *
     * <p>{@code elapsed_ms} 可为 null —— 未完成的阶段本来就没有耗时，
     * 写成 0 会被读成「瞬间跑完」。
     */
    @Data
    public static class Stage {
        private String stage;
        private String status;
        private Integer progress;
        private Long elapsed_ms;
    }
}
