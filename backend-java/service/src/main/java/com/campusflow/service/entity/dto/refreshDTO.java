package com.campusflow.service.entity.dto;

import lombok.Data;

/**
 * 刷新令牌请求体（接口文档 A.1.2 `POST /auth/refresh`）。
 */
@Data
public class refreshDTO {

    private String refresh_token;
}
