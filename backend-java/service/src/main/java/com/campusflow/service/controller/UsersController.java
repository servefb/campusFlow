package com.campusflow.service.controller;


import com.campusflow.common.response.Result;
import com.campusflow.service.service.IUsersService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import org.springframework.web.bind.annotation.RestController;

/**
 * <p>
 *  前端控制器
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@RestController
@RequestMapping("/users")
@AllArgsConstructor
public class UsersController {

    private IUsersService usersService;

    @GetMapping("/me")
    public Result getMe() {
        return usersService.getMe();
    }





}
