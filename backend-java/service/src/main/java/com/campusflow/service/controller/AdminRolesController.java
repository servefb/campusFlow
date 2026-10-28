package com.campusflow.service.controller;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.vo.RoleMatrixVo;
import com.campusflow.service.service.IRolesService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 管理端角色与权限矩阵（{@code /admin/roles*}）。
 *
 * <p>读接口与 {@code /admin/users} 同级（任何管理员可读，页面要拿角色填下拉）；
 * 写接口（PATCH matrix）在 service 里额外要求 {@code user_roles.role_key='super_admin'} ——
 * 矩阵是「谁能干什么」的定义，让普通管理员改它等于把提权入口开在了后台首页。
 *
 * @author JIA
 * @since 2026-09-23
 */
@RestController
@RequestMapping("/admin/roles")
@AllArgsConstructor
public class AdminRolesController {

    private final IRolesService rolesService;

    /** {@code GET /admin/roles} —— 角色体系与成员数。 */
    @GetMapping
    public Result<Map<String, Object>> list() {
        return rolesService.listRoles();
    }

    /** {@code GET /admin/roles/matrix} —— 权限矩阵（角色 × 权限）。 */
    @GetMapping("/matrix")
    public Result<RoleMatrixVo> matrix() {
        return rolesService.getMatrix();
    }

    /** {@code PATCH /admin/roles/matrix} —— 更新矩阵；需超级管理员。 */
    @PatchMapping("/matrix")
    public Result<Map<String, Object>> updateMatrix(@RequestBody RoleMatrixVo payload) {
        return rolesService.updateMatrix(payload);
    }
}
