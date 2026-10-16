package com.campusflow.service.entity.vo;


import lombok.Data;

@Data
public class TaskRequirementsVo {
    private Long id;
    private String name;
    private boolean required;
    private String allowed_types;
    private Long max_size_mb;
    private String status;
    private Long material_id;
}
