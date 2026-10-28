package com.campusflow.service.entity.vo;

import lombok.Data;

@Data
public class TaskTimeLineVo {
    private Long id;
    private String type;
    private String title;
    private String operator;
    private String createdAt;

}
