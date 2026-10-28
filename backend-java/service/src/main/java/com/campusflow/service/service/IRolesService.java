package com.campusflow.service.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.po.Roles;
import com.campusflow.service.entity.vo.RoleMatrixVo;

import java.util.Map;

/**
 * 管理端角色与权限矩阵（{@code /admin/roles*}）。
 *
 * <p>与用户侧（{@link IAdminUsersService}）分开的原因：角色的读接口被「用户与角色」页的
 * 两个下拉、角色体系卡片、权限矩阵三处共用，而矩阵的写接口要求**超级管理员**，
 * 二者的鉴权级别不同 —— 混在一个 service 里，将来给角色加权限时很容易顺手放错级别。
 *
 * @author JIA
 * @since 2026-09-23
 */
public interface IRolesService extends IService<Roles> {

    /**
     * {@code GET /admin/roles} —— 角色体系列表。
     *
     * @return {@code {items: [...], policy_version, updated_at}}，
     *         其中 {@code member_count} 由 {@code user_roles} 实时聚合
     */
    Result<Map<String, Object>> listRoles();

    /**
     * {@code GET /admin/roles/matrix} —— 权限矩阵。
     *
     * <p>权限清单取自 {@link com.campusflow.service.support.PermissionCatalog}（后端为定义源），
     * 勾选状态取自 {@code role_permissions}。库里从未配置过的权限返回空角色数组。
     */
    Result<RoleMatrixVo> getMatrix();

    /**
     * {@code PATCH /admin/roles/matrix} —— 覆盖式更新矩阵。
     *
     * <p>请求里出现的权限键会被**整体替换**（该键下未被点选的角色一律收回），
     * 请求里没出现的权限键保持原样 —— 增量式局部更新比「全量覆盖」更不容易误伤
     * （前端只想改一行时，不必先把整张表读回来再原样回传一遍）。
     */
    Result<Map<String, Object>> updateMatrix(RoleMatrixVo payload);
}
