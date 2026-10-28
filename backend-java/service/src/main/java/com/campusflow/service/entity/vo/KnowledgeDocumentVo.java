package com.campusflow.service.entity.vo;

import lombok.Data;

/**
 * {@code GET /knowledge/documents} 列表项。
 *
 * <h3>2026-09-23 补齐的字段（此前整列空白，见《接口对接说明.md》B 类缺口）</h3>
 * <table border="1">
 *   <caption>新增字段与来源</caption>
 *   <tr><th>字段</th><th>来源</th><th>说明</th></tr>
 *   <tr><td>{@code version}</td><td>{@code knowledge_document_versions.version_no}（{@code is_current=1}）</td><td>版本号</td></tr>
 *   <tr><td>{@code status}</td><td>{@code knowledge_documents.status}</td><td>文档状态</td></tr>
 *   <tr><td>{@code process_state}</td><td>当前版本的 {@code status}</td><td>向量处理进度；与 {@code status} 不同源，后者是文档级、前者是版本级</td></tr>
 *   <tr><td>{@code updated_at} / {@code updated_by}</td><td>{@code knowledge_documents.updated_at} + {@code created_by} 的姓名</td><td>最近改动</td></tr>
 *   <tr><td>{@code word_count}</td><td>当前版本切片正文的 <b>字符数之和</b></td><td>⚠️ 是字符数不是「词数」，中文场景下这才是可读的口径</td></tr>
 *   <tr><td>{@code page_count}</td><td>{@code knowledge_document_versions.page_count}</td><td>解析出的页数</td></tr>
 *   <tr><td>{@code section_count}</td><td>当前版本切片数</td><td>与 {@code chunk_count} 同源，取实际行数</td></tr>
 *   <tr><td>{@code has_conflict}</td><td>{@code knowledge_conflicts} 中存在 {@code pending} 行</td><td>列表上的冲突标记</td></tr>
 * </table>
 *
 * <h3>⚠️ {@code issuer} 的语义修正</h3>
 * 此前这个字段被填成了 {@code issuer_level}（取值形如 {@code school}），
 * 而契约（管理端把它归一化成「发文单位 / 责任单位」展示）要的是<b>单位名称</b>。
 * 现在改成 {@code issuer_organization_id} 关联出的 {@code organizations.name}；
 * 组织查不到时返回 {@code null}（前端显示「—」），**不再回落成级别字符串** ——
 * 用一个看着像名字的英文枚举值顶替单位名，比空着更容易被当成真数据。
 *
 * <p>{@code published_at}（印发时间）与 {@code updated_at}（最近改动）语义不同，
 * 两者都给出、互不顶替，由页面决定降级展示。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class KnowledgeDocumentVo {

    private Long id;

    private String title;

    private String document_no;

    /** 发文 / 责任单位名称，来自 {@code organizations.name}。组织缺失时为 null。 */
    private String issuer;

    private String category;

    private String validity;

    private String published_at;

    // ---------- 2026-09-23 新增 ----------

    /** 当前版本号（{@code v1.0} 之类）。 */
    private String version;

    /** 文档状态：{@code draft / processing / ready / failed / offline / archived}。 */
    private String status;

    /** 版本处理状态（向量化流水线的当前状态）。 */
    private String process_state;

    /** 最近改动时间（{@code knowledge_documents.updated_at}）。 */
    private String updated_at;

    /** 最近改动人姓名；{@code created_by} 指向的用户不存在时为 null。 */
    private String updated_by;

    /** 正文字符数（当前版本切片字符数之和）。无切片时为 0。 */
    private Integer word_count;

    /** 解析页数，来自当前版本；解析器未产出时为 null。 */
    private Integer page_count;

    /** 切片数。 */
    private Integer section_count;

    /** 是否存在待处理的条款冲突。 */
    private Boolean has_conflict;
}
