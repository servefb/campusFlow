package com.campusflow.service.entity.po;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import java.time.LocalDate;
import java.time.LocalDateTime;
import com.baomidou.mybatisplus.annotation.TableId;
import java.io.Serializable;

import com.campusflow.common.enums.ValidityEnum;
import com.campusflow.common.enums.VisibilityEnum;
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
@TableName("knowledge_documents")
public class KnowledgeDocuments implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private Long categoryId;

    private Long issuerOrganizationId;

    private String title;

    private String documentNo;

    private String issuerLevel;

    private ValidityEnum validity;

    private VisibilityEnum visibility;

    private String status;

    private String summary;

    private LocalDateTime publishedAt;

    private LocalDate effectiveFrom;

    private LocalDate effectiveTo;

    private Long referenceCount;

    private String createdBy;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;

    private String activeDocumentNo;


}
