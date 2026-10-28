package com.campusflow.service.entity.vo;


import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

@Data
public class TaskDetailVo {
    private Long id;
    private String title;
    private String status;
    private String template_key;
    private currentStep current_step;
    private String form_data;
    private Integer version;
    private String created_at;
    private String updated_at;
    private List<StepAll> steps;

    @Data
    @AllArgsConstructor
    public static class currentStep{
        private String name;
        private String status;
    }

    @Data
    public  static class StepAll{
        private Long id;
        private Integer step_order;
        private String name;
        private String status;
        private TaskQueryVo.Organization organization;
        private Object assignee;
        private Object result;
        private String started_at;
        private String completed_at;
        private String due_at;

    }
}
