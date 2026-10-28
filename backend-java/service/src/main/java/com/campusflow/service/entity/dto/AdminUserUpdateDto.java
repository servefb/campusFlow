package com.campusflow.service.entity.dto;

import lombok.Data;

/**
 * {@code PATCH /admin/users/{id}} —— 调整角色或状态。
 *
 * <p>两个字段都<b>可选</b>：只传 {@code status} 就是冻结/激活，只传 {@code role_key} 就是换角色。
 * 前端页面上是两个不同的动作（行内「调整角色」、批量「冻结」），共用一个 DTO 不会混淆，
 * 因为「不改的字段为 null」这一约定足够明确。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class AdminUserUpdateDto {

    /** 新的管理端角色 key；null = 不改。传空串("")表示**回收角色**（清空 user_roles 行）。 */
    private String role_key;

    /** {@code active / pending / locked / disabled}；null = 不改。 */
    private String status;
}
