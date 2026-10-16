package com.campusflow.service.entity.dto;


import lombok.Data;

@Data
public class GetNewsHome {
    private String category;
    private String query;
    private Long department_id;
    private Boolean following;
    private Boolean sort;
}
