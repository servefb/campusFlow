package com.campusflow.service.entity.vo;

import lombok.Data;

@Data
public class KnowledgeSectionContentVo {
    private Long id;
    private Long documentId;
    private Long chapterId;
    private String label;
    private String title;
    private String content;
    private Boolean signatureVerified;
    private String version;

}

