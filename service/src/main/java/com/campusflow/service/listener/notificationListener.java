package com.campusflow.service.listener;

import com.campusflow.service.entity.po.Notifications;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.ExchangeTypes;
import org.springframework.amqp.rabbit.annotation.Exchange;
import org.springframework.amqp.rabbit.annotation.Queue;
import org.springframework.amqp.rabbit.annotation.QueueBinding;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class notificationListener {

    private final SimpMessagingTemplate messagingTemplate;

    @RabbitListener(bindings = @QueueBinding(
            value = @Queue(
                    value = "notification_queue",
                    durable = "true"        // 队列持久化，重启不丢
            ),
            exchange = @Exchange(
                    value = "notification_exchange",
                    type = ExchangeTypes.TOPIC,   // 指定交换机类型
                    durable = "true"
            ),
            key = "notification_routingKey"
    ))
    public void handleNotice(Notifications notice) {
       log.info("收到通知：{}", notice.toString());
       if (notice == null) {
           log.warn("收到空通知");
           return;
       }
        Map<String, Object> payload = Map.of(
                "id", notice.getId(),
                "type", notice.getNotificationType(),
                "title", notice.getTitle(),
                "content", notice.getContent() == null ? "" : notice.getContent(),
                "is_read", Boolean.TRUE.equals(notice.getIsRead()),
                "created_at", LocalDateTime.now().withNano(0).toString(),
                "action_url", "/tasks",
                "resource_type", notice.getResourceType() == null ? "" : notice.getResourceType(),
                "resource_id", notice.getResourceId() == null ? "" : notice.getResourceId()
        );
        if (notice.getUserId()==null) {
            pushToAll(payload);
        }else {
            pushToUser(notice.getUserId().toString(), payload);
        }


    }



    // 广播给所有在线客户端
    public void pushToAll(Map<String, Object> payload) {

        messagingTemplate.convertAndSend("/topic/notices", payload);
    }

    // 精准推送给某个用户
    public void pushToUser(String userId, Map<String, Object> payload   ) {
        messagingTemplate.convertAndSendToUser(userId, "/queue/notifications", payload);
    }



}
