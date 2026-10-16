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
@TableName("knowledge_document_versions")
public class KnowledgeDocumentVersions implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private Long documentId;

    private Long sourceFileId;

    private String versionNo;

    private Boolean isCurrent;

    private String status;

    private String signatureAlgorithm;

    private String signatureDigest;

    private Boolean signatureVerified;

    private LocalDateTime signatureVerifiedAt;

    private Integer pageCount;

    private String parserName;

    private Integer chunkCount;

    private String metadata;

    private String createdBy;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private String currentDocumentId;


}
