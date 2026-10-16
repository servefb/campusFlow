package com.campusflow.service.config;

import com.campusflow.tools.jwtutils.JwtUtil;
import io.jsonwebtoken.Claims;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

import java.util.Date;

/**
 * 通知推送的 WebSocket + STOMP 配置（2026-10-09，与前端 notificationSocket.ts 对齐）。
 *
 * <h3>与前端的三条契约</h3>
 * <ul>
 *   <li>端点：{@code /api/v1/ws/notifications}，<b>不要 withSockJS</b> —— 前端是原生 WebSocket；</li>
 *   <li>订阅：前端连上后订两个目的地 —— {@code /user/queue/notifications}（单播，
 *       对应 {@code convertAndSendToUser(userId, "/queue/notifications", ...)}）
 *       与 {@code /topic/notices}（广播，对应 {@code convertAndSend("/topic/notices", ...)}）；</li>
 *   <li>broker 前缀别带空格；{@code setUserDestinationPrefix} 保持默认 {@code /user}（别写完整路径）。</li>
 * </ul>
 *
 * <h3>鉴权为什么在这里而不是 JwtInterceptor</h3>
 * 浏览器原生 WebSocket API 在 HTTP 握手上带不了自定义头，Authorization 只出现在
 * <b>STOMP CONNECT 帧头</b>（晚于握手）——所以 webConfig 里放行 {@code /api/v1/ws/**}，
 * 令牌在这里解：CONNECT 帧的 {@code Authorization: Bearer <token>} 校验通过后设成
 * 会话 Principal，{@code convertAndSendToUser} 按 Principal.getName()（= userId 字符串）找人。
 * 没带令牌 / 令牌无效：不设 Principal —— 广播仍能收（convertAndSend 不认人），单播收不到。
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Autowired
    private JwtUtil jwtUtil;

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // ⚠️ 路径必须是 /ws/notifications，**不带 /api/v1**：本服务所有控制器都注册在根路径
        //   （/tasks、/users/me...），/api/v1 前缀是网关（APISIX 9080 / nginx）剥掉后才转进来的 ——
        //   注册成 /api/v1/ws/notifications 的话，网关剥完前缀 upstream 收到 /ws/notifications，
        //   无此路径 → 落进 JwtInterceptor(/拦截 /**) → 401（2026-10-09 实测踩过）。
        //   前端仍然连 ws(s)://{host}/api/v1/ws/notifications，剥前缀后正好命中这里。
        registry.addEndpoint("/ws/notifications")
                .setAllowedOriginPatterns("*"); // 生产收紧成前端域名；不要 withSockJS
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");
        // setUserDestinationPrefix 不写 = 默认 "/user"，前端订阅 /user/queue/notifications 正好对上
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor =
                        MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
                if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
                    String auth = accessor.getFirstNativeHeader("Authorization");
                    if (auth != null && auth.startsWith("Bearer ")) {
                        try {
                            Claims claims = jwtUtil.extractAllClaims(auth.substring(7));
                            Object userId = claims == null ? null : claims.get("userId");
                            Object expiration = claims == null ? null : claims.getExpiration();
                            boolean expired = expiration != null
                                    && ((Date) expiration).before(new Date());
                            // Principal.getName() 必须与推送侧 convertAndSendToUser 的 userId 一致
                            if (userId != null && !expired) {
                                final String principalName = String.valueOf(userId);
                                accessor.setUser(new java.security.Principal() {
                                    @Override
                                    public String getName() {
                                        return principalName;
                                    }
                                });
                            }
                        } catch (Exception ignored) {
                            // 令牌解析失败：不设 Principal（单播收不到），不打断连接
                        }
                    }
                }
                return message;
            }
        });
    }
}
