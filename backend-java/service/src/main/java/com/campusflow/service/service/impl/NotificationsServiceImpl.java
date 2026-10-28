package com.campusflow.service.service.impl;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.context.UserContext;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.UserNotificationRead;
import com.campusflow.service.entity.dto.AdminNotificationDto;
import com.campusflow.service.entity.dto.NotificationsDto;
import com.campusflow.service.entity.po.Notifications;
import com.campusflow.service.entity.vo.NotificationsVo;
import com.campusflow.service.mapper.NotificationsMapper;
import com.campusflow.service.service.INotificationsService;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.campusflow.service.service.IUserNotificationReadService;
import lombok.RequiredArgsConstructor;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;



/**
 * <p>
 * 服务实现类
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@Service
@RequiredArgsConstructor
public class NotificationsServiceImpl extends ServiceImpl<NotificationsMapper, Notifications> implements INotificationsService {


    private final RabbitTemplate rabbitTemplate;
    private final IUserNotificationReadService userNotificationReadService;

    @Override
    public Result<BaseQueryVo<NotificationsVo.Notification>> getNotifications(NotificationsDto notificationsDto) {
        Long userId = UserContext.getUserId();
        Page<Notifications> page = lambdaQuery().eq(Notifications::getUserId, userId)
                .or()
                .isNull(Notifications::getUserId)
                .orderByDesc(Notifications::getCreatedAt)
                .page(new Page<>(notificationsDto.getPage(), notificationsDto.getPage_size()));


        List<Notifications> records = page.getRecords();
        List<Long> notificationsIds = records.stream().map(Notifications::getId).toList();
        List<UserNotificationRead> userNotificationReadList = userNotificationReadService.lambdaQuery().in(UserNotificationRead::getNotificationId, notificationsIds)
                .eq(UserNotificationRead::getUserId, userId).list();
        Map<Long, LocalDateTime> collect = userNotificationReadList.stream().collect(Collectors.toMap(UserNotificationRead::getNotificationId, UserNotificationRead::getReadAt));


        List<NotificationsVo.Notification> list = records.stream().map(no -> {
            NotificationsVo.Notification notification = new NotificationsVo.Notification();

            if (!userNotificationReadList.isEmpty() && collect.containsKey(no.getId())) {
                notification.setIs_read(true);
            } else {
                notification.setIs_read(no.getIsRead());
            }
            notification.setCreated_at(no.getCreatedAt().toString());
            notification.setId(no.getId());
            notification.setTitle(no.getTitle());
            notification.setContent(no.getContent());
            return notification;
        }).toList();
        BaseQueryVo<NotificationsVo.Notification> notificationsVo = new BaseQueryVo<>();
        notificationsVo.setItems(list);
        notificationsVo.setTotal(page.getTotal());
        notificationsVo.setPage(notificationsDto.getPage());
        notificationsVo.setPage_size(notificationsDto.getPage_size());
        notificationsVo.setHas_more(page.hasNext());
        return new Result<BaseQueryVo<NotificationsVo.Notification>>().success(notificationsVo);
    }

    @Override
    public Result<?> postNotifications(AdminNotificationDto adminNotificationDto) {

        Notifications build = Notifications.builder()
                .title(adminNotificationDto.getTitle())
                .content(adminNotificationDto.getContent())
                .notificationType(adminNotificationDto.getNotification_type())
                .actionUrl(adminNotificationDto.getAction_url())
                .expiresAt(adminNotificationDto.getExpires_at() != null ? LocalDateTime.parse(adminNotificationDto.getExpires_at(), java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")) : null)
                .build();
        boolean save = save(build);
        if (save) {
            rabbitTemplate.convertAndSend("notification_exchange", "notification_routingKey", build);
        }
        return new Result<>().success(build);
    }

    @Override
    public Result<?> getUnreadCount() {

        Long userId = UserContext.getUserId();
        List<UserNotificationRead> list = userNotificationReadService.lambdaQuery().eq(UserNotificationRead::getUserId, userId).list();
        List<Long> notificationsIds = list.stream().map(UserNotificationRead::getNotificationId).toList();
        Long count = lambdaQuery().eq(Notifications::getUserId, userId)
                .eq(Notifications::getIsRead, false)
                .isNull(Notifications::getUserId)
                .notIn(!notificationsIds.isEmpty(),Notifications::getId, notificationsIds)
                .count();
        return new Result<>().success(Map.of("unread_count", count != null ? count : 0));
    }

    @Override
    public Result<?> readNotification(Long id) {
        Notifications byId = getById(id);
        if (byId.getUserId() == null) {
            UserNotificationRead userNotificationRead = new UserNotificationRead();
            userNotificationRead.setNotificationId(id);
            userNotificationRead.setUserId(UserContext.getUserId());
            userNotificationRead.setReadAt(LocalDateTime.now());
            boolean save = userNotificationReadService.save(userNotificationRead);
            if (save) {
                return new Result<>().success();
            }
            return Result.failure(500, "Failed to read notification");
        }
        boolean b = updateById(byId.setIsRead(true));
        if (b) {
            return new Result<>().success();
        }
        return Result.failure(400, "Failed to read notification");
    }

    @Override
    @Transactional
    public Result<?> readAllNotifications() {
        Long userId = UserContext.getUserId();
        List<UserNotificationRead> list = userNotificationReadService.lambdaQuery().eq(UserNotificationRead::getUserId, userId).list();
        List<Notifications> notificationsList = lambdaQuery().isNull(Notifications::getUserId).notIn(!list.isEmpty(),Notifications::getId, list.stream().map(UserNotificationRead::getNotificationId).toList()).list();
        List<UserNotificationRead> userNotificationReadList = new ArrayList<>();
        notificationsList.forEach(notification -> {
            UserNotificationRead userNotificationRead = new UserNotificationRead();
            userNotificationRead.setNotificationId(notification.getId());
            userNotificationRead.setUserId(userId);
            userNotificationRead.setReadAt(LocalDateTime.now());
            userNotificationReadList.add(userNotificationRead);
        });
        boolean save = userNotificationReadService.saveBatch(userNotificationReadList);

        boolean b = lambdaUpdate().eq(Notifications::getUserId, userId)
                .eq(Notifications::getIsRead, false)
                .update(Notifications.builder().isRead(true).build());
        if (b && save) {
            return new Result<>().success();
        }
        return Result.failure(400, "Failed to read notifications");
    }
}
