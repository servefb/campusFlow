package com.campusflow.service.entity.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
public class TaskRequirementsByTemplateKeyVo {

    private String template_key;

    private List<Requirements> requirements;
    private List<Steps> steps;

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static
    class Requirements {
        private String requirement_key;
        private String name;
        private String allowed_content_types;
        private Long max_size_bytes;
        private Boolean is_required;
    }
    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static
    class Steps {
        private Long step_id;
        private Integer step_order;
        private Long organization_id;
        private String name;
        private Boolean requires_user_action;
    }
}
