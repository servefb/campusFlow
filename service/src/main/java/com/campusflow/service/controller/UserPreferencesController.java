package com.campusflow.service.controller;


import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.UserPreferenceDto;
import com.campusflow.service.service.IUserPreferencesService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.*;

/**
 * <p>
 * 前端控制器
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@RestController
@RequestMapping("/users/me/preferences")
@AllArgsConstructor
public class UserPreferencesController {

    private IUserPreferencesService userPreferencesService;

    @GetMapping
    public Result getPreferences() {
        return userPreferencesService.getPreferences();
    }

    @PatchMapping
    public Result updatePreferences(@RequestBody UserPreferenceDto userPreferenceDto) {
        return userPreferencesService.updatePreferences(userPreferenceDto);
    }

}
