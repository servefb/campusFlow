package com.campusflow.service.entity.dto;

import lombok.Data;

/**
 * {@code GET /knowledge/admin/conflicts} 的查询参数（无注解的 POJO 参数由 Spring 按 query 绑定）。
 *
 * <p>只留一个 {@code status} 筛选：{@code knowledge_conflicts} 上有索引
 * {@code idx_knowledge_conflicts_pending(status, severity, created_at)}，
 * 前导列正是 {@code status}。加 {@code severity} 之类的其它条件都用不上这个索引，
 * 而这张表的量级（管理台人工核对）根本不需要再多的筛选维度。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class ConflictQueryDto {

    /**
     * {@code pending / resolved / ignored}。缺省 = 不过滤（看全部）。
     *
     * <p>⚠️ 前端的「全部」哨兵值 {@code all} 由服务层摘掉，不能当条件下发 ——
     * 那是「不过滤」的意思，精确匹配 {@code all} 会查出 0 行（既有约定，见《接口对接说明》）。
     */
    private String status;

    private Integer page;

    private Integer page_size;
}
