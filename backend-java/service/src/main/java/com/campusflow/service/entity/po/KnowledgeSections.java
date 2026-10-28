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
@TableName("knowledge_sections")
public class KnowledgeSections implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private Long versionId;

    private Long parentSectionId;

    private Integer chapterNo;

    private Integer articleNo;

    private Integer chunkIndex;

    private String heading;

    private String sectionLabel;

    private String content;

    private Integer pageStart;

    private Integer pageEnd;

    private Integer tokenCount;

    private String metadata;

    private LocalDateTime createdAt;


}
