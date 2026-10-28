package com.campusflow.service.entity.vo;


import com.campusflow.service.entity.po.Users;
import lombok.Data;

@Data
public class LoginVo {

    private String access_token;
    private String refresh_token;
    private Long expires_in;
    private Users user;

}
