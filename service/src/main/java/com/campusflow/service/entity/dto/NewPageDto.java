package com.campusflow.service.entity.dto;


import lombok.Data;

@Data
public class NewPageDto {
    private String category;
    private String query;
    private Integer page;
    private Integer page_size;
    private String sort;
}
