package com.campusflow.service.entity.dto;


import lombok.Data;

import java.util.List;

@Data
public class CreateTaskDto {
    private Long templateId;
    private String title;
    private String templateKey;
    private Long conversationId;
    private Long sourceMessageId;
    private String categoryId;
    private String reason;
    private List<Step> steps;
    private List<Requirement> requirements;

    @Data
    public static
    class Step {
        private Integer stepId;
        private Integer stepOrder;
        private String name;
        private Boolean requiresUserAction;
        private Long organizationId;
    }

    @Data
    public static
    class Requirement {
        private String requirementKey;
        private String name;
        private List<String> allowedContentTypes;
        private Boolean isRequired;
        private Long maxSizeBytes;
    }
}
