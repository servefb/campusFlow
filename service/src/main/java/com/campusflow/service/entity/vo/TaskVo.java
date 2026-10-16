package com.campusflow.service.entity.vo;

import lombok.Data;

@Data
public class TaskVo {

//    "id":76,"title":"学生证补办申请","status":"draft","version":1,"current_step":"填写申请","created_at":"2026-09-04T15:15:00+08:00"
    private Long id;
    private String title;
    private String status;
    private Integer version;
    private String current_step;
    private String created_at;
}
