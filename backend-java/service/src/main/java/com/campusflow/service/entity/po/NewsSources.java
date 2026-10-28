package com.campusflow.service.entity.po;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import java.time.LocalDateTime;
import com.baomidou.mybatisplus.annotation.TableId;
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
@TableName("news_sources")
public class NewsSources implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    private String id;

    private String organizationId;

    private String name;

    private String sourceType;

    private String sourceUrl;

    private String syncRule;

    private Boolean isEnabled;

    private LocalDateTime lastSyncAt;

    private String lastSyncStatus;

    private String lastError;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;


}
