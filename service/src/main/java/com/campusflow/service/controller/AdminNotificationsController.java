package com.campusflow.service.controller;


import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.AdminNotificationDto;
import com.campusflow.service.entity.dto.NotificationsDto;
import com.campusflow.service.service.INotificationsService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/**
 * <p>
 *  前端控制器
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@RestController
@RequestMapping("/admin/notifications")
@RequiredArgsConstructor
public class AdminNotificationsController {

    private final INotificationsService notificationsService;


    @PostMapping
    public Result<?> postNotifications(@RequestBody AdminNotificationDto adminNotificationDto) {
        return notificationsService.postNotifications(adminNotificationDto);
    }

    @GetMapping
    public Result<?> getNotifications(NotificationsDto notificationsDto) {
        return notificationsService.getNotifications(notificationsDto);
    }



}
