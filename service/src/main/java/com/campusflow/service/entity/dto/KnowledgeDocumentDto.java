package com.campusflow.service.entity.dto;

import com.campusflow.common.enums.ValidityEnum;
import lombok.Data;

/**
 * {@code GET /knowledge/documents} 查询参数。
 *
 * <h3>2026-09-23 补齐的两个参数</h3>
 * <ul>
 *   <li>{@code category} —— <b>分类名</b>（不是 id）。管理端工作区的分类下拉取的就是
 *       {@code GET /knowledge/categories} 的 {@code name}；之前 DTO 里只有 {@code category_id}，
 *       前端发的 {@code category=教务与培养管理} 绑不上 → 静默返回全量
 *       （筛选看起来生效了、其实没有，比报错更难发现）。现在两个都支持：
 *       给了 {@code category_id} 就以它为准，否则按 {@code category} 名称解析成 id 集合。</li>
 *   <li>{@code status} —— {@code draft / processing / ready / failed / offline / archived}。
 *       管理端工作区有「全部 / 待入库 / 入库失败」页签，之前发的 {@code status} 同样被忽略。</li>
 * </ul>
 *
 * <p>⚠️ {@code query} 在 2026-09-21 的实测里被忽略，但 <b>2026-09-23 复测已正常生效</b>
 * （不同关键词返回不同结果集）。管理端那条「后端未生效」的警告提示已随之删除 ——
 * 过期的警告和假数字一样会误导人。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class KnowledgeDocumentDto {

    private Long category_id;

    /** 分类名（与 {@code category_id} 二选一；两个都给时以 id 为准）。 */
    private String category;

    private String query;

    /** 文档状态，取值同 {@code knowledge_documents.status} 的 enum。 */
    private String status;

    private ValidityEnum validity;

    private String issuer_level;

    private Boolean sort;

    private Integer page;

    private Integer page_size;
}
