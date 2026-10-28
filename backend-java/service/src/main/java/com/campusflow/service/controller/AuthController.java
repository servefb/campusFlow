package com.campusflow.service.controller;


import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.loginDTO;
import com.campusflow.service.entity.dto.refreshDTO;
import com.campusflow.service.service.IUsersService;
import lombok.AllArgsConstructor;
import org.mindrot.jbcrypt.BCrypt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/auth")
@AllArgsConstructor
public class AuthController {

    private final IUsersService usersService;

    @PostMapping("/login")
    public Result login(@RequestBody loginDTO loginDTO) {
        return usersService.login(loginDTO);
    }

    /**
     * 刷新令牌（接口文档 A.1.2）：用 refresh token 换一对新的 access/refresh token。
     * 该端点不能要求 Bearer access token（access 已过期才会来刷新），
     * 已在 tools/webConfig 的拦截器放行列表中排除。
     */
    @PostMapping("/refresh")
    public Result refresh(@RequestBody refreshDTO refreshDTO) {
        return usersService.refresh(refreshDTO);
    }



}
