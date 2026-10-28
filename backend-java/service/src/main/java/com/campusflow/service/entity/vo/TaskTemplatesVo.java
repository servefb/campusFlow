package com.campusflow.service.entity.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TaskTemplatesVo {

    public List<TaskTemplates> items;

    @Data
    @NoArgsConstructor
    public static class TaskTemplates{
        private Long id;
        private String template_key;
        private String name;
        private String description;
        private String responsible_organization_name;
        private Long requirement_count;
        private Long step_count;
    }

}
