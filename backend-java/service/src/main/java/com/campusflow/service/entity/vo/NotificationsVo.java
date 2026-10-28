package com.campusflow.service.entity.vo;

import lombok.Data;

import java.util.List;

public class NotificationsVo {

    private List<Notification> items;


    @Data
    public static
    class Notification {
    private Long id;
    private String type;
    private String title;
    private String content;
    private Boolean is_read;
    private String created_at;  }
}
