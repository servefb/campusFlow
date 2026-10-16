package com.campusflow.service.entity.vo;

import lombok.Data;

import java.util.List;

/**
 * {@code GET /admin/roles} 列表项 —— 角色体系卡片。
 *
 * <p>{@code member_count} 由 {@code user_roles} 实时聚合，<b>不读 {@code roles} 表的冗余列</b>
 * （那张表压根没有这一列，见 {@code 2026-09-23-admin-console.sql} 的注释）。
 *
 * <p>{@code capabilities} 出参是<b>字符串数组</b>而不是 {@code roles.capabilities} 那一列
 * 存着的 JSON 文本：契约（管理端 {@code AdminRole.capabilities}）就是数组，
 * 让每个前端各自 {@code JSON.parse} 一次，迟早有一处忘了 try/catch，解析失败整页白屏。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class AdminRoleVo {

    private String key;

    private String name;

    /** 系统角色 / 业务角色 / 受限角色。 */
    private String kind;

    private long member_count;

    private String description;

    private List<String> capabilities;

    private String scope_note;

    /** 排序权重，供前端稳定排序（不排序时接口顺序就决定 UI 顺序，改一条 SQL 就会跳）。 */
    private Integer sort_order;
}
