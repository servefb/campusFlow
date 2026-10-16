package com.campusflow.service.controller;


import com.campusflow.common.response.Result;
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
@RequestMapping("/users/me/notifications")
@RequiredArgsConstructor
public class NotificationsController {

    private final INotificationsService notificationsService;

    @GetMapping
    public Result<?> getNotifications(NotificationsDto notificationsDto) {
        return notificationsService.getNotifications(notificationsDto);
    }

    @GetMapping("/unread-count")
    public Result<?> getUnreadCount() {
        return notificationsService.getUnreadCount();
    }

    @PatchMapping("/{id}/read")
    public Result<?> readNotification(@PathVariable Long id) {
        return notificationsService.readNotification(id);
    }

    @PostMapping("/read-all")
    public Result<?> readAllNotifications() {
        return notificationsService.readAllNotifications();
    }



}
