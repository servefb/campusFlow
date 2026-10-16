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
 * 管理端角色（{@code roles}）。
 *
 * <p>与 {@code users.role} 的关系见 {@code 2026-09-23-admin-console.sql} 头部注释：
 * 这里是<b>细粒度管理角色</b>（授权），{@code users.role} 是登录闸门（身份），两者并存。
 *
 * <p>{@code member_count} 刻意**不落库** —— 它是 {@code user_roles} 的实时聚合结果，
 * 存一份就一定会和明细漂移（那种「成员数 6 人、列表只有 4 行」的页面没人查得出原因）。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("roles")
public class Roles implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.ASSIGN_ID)
    private Long id;

    /** 接口里的 {@code role_key}，如 {@code knowledge_governor}。 */
    private String roleKey;

    private String name;

    /** 系统角色 / 业务角色 / 受限角色 —— 纯展示分组，不参与鉴权。 */
    private String kind;

    private String description;

    /** 能力摘要，JSON 数组字符串（{@code ["全部 16 项特权", ...]}），展示用。 */
    private String capabilities;

    private String scopeNote;

    private Boolean isSystem;

    private Integer sortOrder;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
