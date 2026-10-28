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
 * 角色 × 权限（{@code role_permissions}）—— 权限矩阵的存储行。
 *
 * <p>语义是「<b>有没有这一行</b>」，不是「这一行的值」：
 * {@code allowed=true} 表示该角色拥有该权限，{@code false} 表示显式收回
 * （留着 {@code false} 行是为了将来做角色继承时能覆盖父角色的授权）。
 * 查询侧一律按 {@code allowed=1} 过滤，别把「行存在」当成「已授权」。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("role_permissions")
public class RolePermissions implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.ASSIGN_ID)
    private Long id;

    private String roleKey;

    private String permissionKey;

    private Boolean allowed;

    private Long updatedBy;

    private LocalDateTime updatedAt;
}
