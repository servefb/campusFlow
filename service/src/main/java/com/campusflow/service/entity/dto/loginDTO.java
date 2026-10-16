package com.campusflow.service.entity.dto;


import lombok.Data;

@Data
public class loginDTO {

    private String account;
    private String password;
    private Boolean rememberMe;
}
