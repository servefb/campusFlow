package com.campusflow.service.entity.po;

import com.baomidou.mybatisplus.annotation.*;

import java.time.LocalDateTime;
import java.io.Serializable;

import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.experimental.Accessors;

/**
 * <p>
 *
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("users")
public class Users implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.ASSIGN_ID)
    private Long id;

    private String organizationId;

    private String account;

    private String name;

    private String role;

    private String departmentName;

    private String studentOrStaffNo;

    private String email;

    private byte[] phoneEncrypted;

    private Long avatarFileId;

    private Boolean isActive;

    /**
     * 管理端账号状态：{@code active / pending / locked / disabled}
     * （{@code enum} 列，2026-09-23 新增，见 {@code db/2026-09-23-users-admin-columns.sql}）。
     *
     * <p>⚠️ 与 {@link #isActive} 是**一对必须同步**的字段：
     * {@code active ⇔ is_active=1}，其余三态 {@code ⇒ is_active=0}。
     * 同步集中在 {@code AdminUsersServiceImpl#applyStatus}，别在别处单独改其中一个 ——
     * 两列各改一半，登录闸门（只认 is_active）与管理端界面（只认 status）就会各说各话。
     */
    private String status;

    private LocalDateTime lastLoginAt;

    /** 最近一次登录 IP（06 章登录流程回写）。 */
    private String lastLoginIp;

    /** 最近登录网络：内网 / VPN / 校外。 */
    private String network;

    /** 身份核验备注，展示用。 */
    private String identityNote;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
    @TableField(
            value = "active_student_or_staff_no",
            insertStrategy = FieldStrategy.NEVER,
            updateStrategy = FieldStrategy.NEVER
    )
    private String activeStudentOrStaffNo;


}
