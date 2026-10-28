package com.campusflow.service.entity.vo;

import lombok.Data;

import java.util.List;

/**
 * {@code GET|PATCH /admin/roles/matrix} —— 权限矩阵（角色 × 权限）。
 *
 * <h3>为什么权限清单由后端给、而不是前端写死</h3>
 * 前端的「编辑权限矩阵」要渲染一张 {@code 权限 × 角色} 的表格，如果权限清单写在前端，
 * 后端新增一项权限（比如「新闻发布」）时前端完全不知道，那项特权就成了只有后端认、
 * 界面里看不见也改不了的幽灵权限。所以清单在 {@code PermissionCatalog}（后端），
 * 勾选状态在 {@code role_permissions} 表。
 *
 * <h3>{@code roles} 是「拥有该权限的角色 key 数组」</h3>
 * 前端 {@code RoleMatrix.permissions[].roles} 就是这个形状。反过来给「角色的权限数组」
 * 也能表达同一件事，但表格是按行渲染的，行内带列集合更省一次转置。
 *
 * <p>{@code policy_version} 是个<b>人工维护的策略版本号</b>（形如 {@code RBAC-POLICY-V4}），
 * 只表示「这份矩阵的版本」，不参与鉴权。取自配置，改策略时才递增。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class RoleMatrixVo {

    private String updated_at;

    private String policy_version;

    private List<Permission> permissions;

    @Data
    public static class Permission {

        /** 权限标识，如 {@code knowledge.document.publish}。 */
        private String key;

        private String name;

        /** 分组：知识治理 / 内容审核 / 用户与权限 / 系统与运维 / 数据与报表。 */
        private String group;

        /** 拥有该权限的角色 key 列表（空数组 = 当前无人拥有，不是「未回传」）。 */
        private List<String> roles;
    }
}
