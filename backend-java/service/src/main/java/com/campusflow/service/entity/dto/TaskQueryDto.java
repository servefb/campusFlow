package com.campusflow.service.entity.dto;

import lombok.Data;

@Data
public class TaskQueryDto {
    private String status;
    private String keyword;
    /** 页码，从 1 开始；不传时默认 1 */
    private int page = 1;
    /** 每页条数；不传时默认 10 */
    private int page_size;
    private Boolean sort;
}

