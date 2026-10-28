package com.campusflow.service.entity.vo;

import lombok.Data;

import java.time.OffsetDateTime;

/**
 * {@code GET /knowledge/admin/conflicts} 的一条条款冲突（契约文档 11.2）。
 *
 * <h3>🔴 这里只出现 {@code knowledge_conflicts} 真有、或能 join 出来的字段</h3>
 * 管理端原型的冲突面板画的是「新旧两段条文对照 + 置信度 + 检出模型」，
 * 但真库的 {@code knowledge_conflicts} 只有
 * {@code conflict_type / severity / description / status / resolution / resolved_*}，
 * <b>没有</b>置信度、没有「原文片段 / 拟议片段」的文本与行号、也没有检出模型名
 * （2026-09-23 逐列核对 {@code information_schema} 确认）。
 *
 * <p>所以下面这组字段就是<b>全部</b>能给的东西：前端把
 * {@code confidence} / {@code source_version} / {@code proposed_version}
 * 当作「未回传」降级渲染，不要用别的字段顶替，也不要在这里编一个假分数 ——
 * 一个假的 0.96 比一个「—」危险得多，它看起来像真的。
 *
 * <h3>字段名为什么是 snake_case</h3>
 * 与 {@code ReviewItemVo} 同一约定：管理端 {@code types/api.ts} 就读 snake_case，
 * 换风格等于整块读不出来。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class KnowledgeConflictVo {

    private Long id;

    /** 被检出的文档 id（{@code knowledge_conflicts.document_id}）。 */
    private Long document_id;

    /** 该文档标题，取自 {@code knowledge_documents.title}；文档已删或不存在时为 null。 */
    private String document_title;

    /** 与之冲突的另一份文档 id，可为 null（{@code conflicting_document_id}）。 */
    private Long conflicting_document_id;

    /** 另一份文档的标题；{@code conflicting_document_id} 为 null 或查不到时为 null。 */
    private String conflicting_document_title;

    /** 冲突类型码，如 {@code test_conflict}。库列是 {@code varchar(48)} 且<b>无 CHECK</b>，原样上屏。 */
    private String conflict_type;

    /** {@code high / medium / low}（库有 CHECK 约束）。 */
    private String severity;

    /** 冲突描述全文。 */
    private String description;

    /** {@code pending / resolved / ignored}（库有 CHECK 约束）。 */
    private String status;

    /**
     * 处置结论。本实现写入的是动作码（{@code accepted_proposed / kept_current / deferred}）
     * 加上管理员填的备注，见 {@code AdminKnowledgeServiceImpl#resolveConflict}。
     */
    private String resolution;

    /** 处置人 id。 */
    private Long resolved_by;

    /** 处置人姓名，取自 {@code users.name}；用户已注销时为 null。 */
    private String resolved_by_name;

    private OffsetDateTime resolved_at;

    private OffsetDateTime created_at;
}
