package com.campusflow.service.entity.vo;


import lombok.Data;

@Data
public class UserPreferencesVo {
    private String default_agent_mode;
    private String answer_length;
    private boolean show_citations;
    private boolean task_notifications;
    private boolean knowledge_notifications;
    private int history_retention_days;

}
