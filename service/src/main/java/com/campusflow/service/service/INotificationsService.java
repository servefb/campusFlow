package com.campusflow.service.service;

import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.AdminNotificationDto;
import com.campusflow.service.entity.dto.NotificationsDto;

import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.service.entity.po.Notifications;
import com.campusflow.service.entity.vo.NotificationsVo;

/**
 * <p>
 *  服务类
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
public interface INotificationsService extends IService<Notifications> {

    Result<BaseQueryVo<NotificationsVo.Notification>> getNotifications(NotificationsDto notificationsDto);

    Result<?> postNotifications(AdminNotificationDto adminNotificationDto);

    Result<?> getUnreadCount();

    Result<?> readNotification(Long id);

    Result<?> readAllNotifications();

}
