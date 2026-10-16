package com.campusflow.service.entity.dto;

import lombok.Data;

/**
 * {@code GET /knowledge/admin/jobs} 的查询参数。
 *
 * <p>三个筛选都对应真实列、且都是「不给 = 不筛」：
 * {@code status} 与 {@code job_type} 是 {@code knowledge_jobs} 上的普通列，
 * {@code document_id} 外接文档。
 *
 * <p>⚠️ 前端页面的「全部」哨兵同样由服务层摘掉（见 {@link ConflictQueryDto} 的说明）。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class KnowledgeJobQueryDto {

    /** {@code pending / running / completed / failed / cancelled}。 */
    private String status;

    /** 只看某份文档的作业。 */
    private Long document_id;

    /** {@code ingest} 等，库列 {@code varchar(32)} 无 CHECK。 */
    private String job_type;

    private Integer page;

    private Integer page_size;
}
