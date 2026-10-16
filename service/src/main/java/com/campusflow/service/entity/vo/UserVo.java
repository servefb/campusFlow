package com.campusflow.service.entity.vo;


import lombok.Data;

@Data
public class UserVo {
    private String id;
    private String account;
    private String name;
    private String role;
    private String department;
    private String avatar_url;

}
