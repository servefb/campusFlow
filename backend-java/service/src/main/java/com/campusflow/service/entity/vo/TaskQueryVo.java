package com.campusflow.service.entity.vo;

import com.campusflow.common.context.BaseQueryVo;
import lombok.AllArgsConstructor;
import lombok.Data;



@Data
public class TaskQueryVo{

    private Long id;
    private String task_no;
    private String title;
    private String status;
    private Integer current_step_order;
    private String current_step;
    private Integer total_steps;
    private String current_step_status;
    private Organization responsible_organization;
    private String created_at;
    private String updated_at;


    @AllArgsConstructor
    @Data
    public static
    class currentStep{
        private String name;
        private Integer currentStepOrder;
    }

    @Data
    @AllArgsConstructor
    public static class Organization {
        private Long id;
        private String name;
    }
}
