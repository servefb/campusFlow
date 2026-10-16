package com.campusflow.service.entity.dto;


import lombok.Data;

@Data
public class PostFileDto {
    private String filename;
    private String content_type;
    private Long size_bytes;
    private String purpose;
}
