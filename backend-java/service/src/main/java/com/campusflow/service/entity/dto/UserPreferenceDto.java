package com.campusflow.service.entity.dto;


import lombok.Data;

import java.time.LocalDateTime;

@Data
public class UserPreferenceDto {
    private String default_agent_mode;
    private String answer_length;
    private Boolean show_citations;
    private Boolean task_notifications;
    private Boolean knowledge_notifications;
    private Integer history_retention_days;
    private LocalDateTime updated_at=LocalDateTime.now();

}
