package com.campusflow.service.entity.po;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import java.time.LocalDateTime;
import com.baomidou.mybatisplus.annotation.TableId;
import java.io.Serializable;

import lombok.*;
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
@Builder
@TableName("notifications")
@NoArgsConstructor
@AllArgsConstructor
public class Notifications implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private Long userId;

    private String notificationType;

    private String title;

    private String content;

    private String resourceType;

    private String resourceId;

    private String actionUrl;

    private Boolean isRead;

    private LocalDateTime readAt;

    private LocalDateTime createdAt;

    private LocalDateTime expiresAt;


}
