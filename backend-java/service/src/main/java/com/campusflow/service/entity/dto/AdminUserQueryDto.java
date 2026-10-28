package com.campusflow.service.entity.dto;

import lombok.Data;

/**
 * {@code GET /admin/users} 查询参数。
 *
 * <p>参数名与前端 {@code services/users.ts} 发出的完全一致（{@code keyword} / {@code department} /
 * {@code role_key} / {@code page} / {@code page_size}）—— 绑定不上就静默返回全量，
 * 页面像是「筛选没反应」，这类问题在联调时最难往参数名上想。
 *
 * <p>⚠️ {@code department} 是按**展示名**精确匹配 {@code users.department_name}
 * （页面的下拉选项就是这个字段渲染出来的，天生同源）；{@code role_key} 是按管理端角色精确匹配。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class AdminUserQueryDto {

    /** 关键词：姓名 / 账号 / 邮箱任一包含即命中（大小写不敏感由库的排序规则保证）。 */
    private String keyword;

    /** 归属学院 / 部门展示名；{@code all} 或空表示不限。 */
    private String department;

    /** 管理端角色 key；{@code all} 或空表示不限。 */
    private String role_key;

    private Integer page;

    private Integer page_size;
}
