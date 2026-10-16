package com.campusflow.service.entity.dto;

import lombok.Data;

/**
 * {@code POST /admin/users} —— 新建账号 / 邀请管理员。
 *
 * <p>语义是「邀请」不是「直接建号」：新建出来的账号 {@code status='pending'}、
 * {@code is_active=0}，等人走完统一身份认证核验才变成 {@code active}。
 * 这也是页面上那句「账号在完成统一身份认证核验后自动激活」的落地方式 ——
 * 文案和状态必须对得上，否则就是一句办不到的承诺。
 *
 * <p>不接收密码：本项目统一走 CAS / SAML，管理端没有「给谁设个密码」这条路径
 * （{@code user_credentials} 的约束也要求 {@code password_hash} 与 {@code sso_subject} 至少有一个）。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class AdminUserCreateDto {

    private String name;

    /** 工号 / 学号，落到 {@code users.account}（唯一）。 */
    private String account;

    private String email;

    /** 归属学院 / 部门展示名，落到 {@code users.department_name}。 */
    private String department;

    /** 要授予的管理端角色 key，必须已存在于 {@code roles} 表。 */
    private String role_key;
}
