package com.campusflow.service.entity.dto;


import lombok.Data;

@Data
public class CoursesDto {

    private Integer page;
    private Integer page_size;
    private String keyword;
    private String course_type;
    private Integer organization_id;
    private Boolean sort;

}
