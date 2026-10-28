package com.campusflow.service.entity.vo;


import lombok.Data;

@Data
public class AutoLogVo {
    private Long id;
    private Long operator_id;
    private String operator_name;
    private String action;
    private String resource_type;
    private Long resource_id;
    private String result;
    private String ip_address;
    private String created_at;

}
