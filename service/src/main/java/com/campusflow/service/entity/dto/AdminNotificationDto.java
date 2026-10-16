package com.campusflow.service.entity.dto;

import lombok.Data;

@Data
public class AdminNotificationDto {

    private String title; // 标题
    private String content; // 内容
    private String notification_type; // 通知类型
    private String action_url; // 动作链接
    private String expires_at; // 过期时间
}
