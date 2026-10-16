package com.campusflow.service.entity.po;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.experimental.Accessors;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 用户 × 管理端角色（{@code user_roles}）。
 *
 * <p>⚠️ 表上有 {@code UNIQUE KEY uq_user_role (user_id)}：<b>一人一角色</b>。
 * 管理端 UI 的「批量分配角色」就是覆盖写这一列，所以 service 层必须用
 * upsert（先查后改/插）而不是无脑 insert —— 第二次分配同一用户会撞唯一键报 500。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("user_roles")
public class UserRoles implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.ASSIGN_ID)
    private Long id;

    private Long userId;

    private String roleKey;

    /** 授权人 id，追溯「谁给的权限」。系统种子行为 null。 */
    private Long grantedBy;

    private LocalDateTime grantedAt;
}
