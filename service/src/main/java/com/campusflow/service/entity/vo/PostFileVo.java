package com.campusflow.service.entity.vo;


import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
public class PostFileVo {
    private Long file_id;
    private String upload_url;
    private String upload_method;
    private Headers headers;
    private int expires_in;


    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class Headers {
        private String content_type;
    }

}
