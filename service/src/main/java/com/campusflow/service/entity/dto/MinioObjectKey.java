package com.campusflow.service.entity.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class MinioObjectKey {

    private String fileId;
    private String bucket;
    private String objectKey;
    private String userId;
    private String fileName;
    private String action;
    private String category;

    @Data
    @Builder
    public static class KnowledgeCategory{
        private Long id;
        private String name;
        private String code;
    }
}
