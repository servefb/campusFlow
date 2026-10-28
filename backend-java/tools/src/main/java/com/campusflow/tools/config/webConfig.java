package com.campusflow.tools.config;


import com.campusflow.tools.interceptor.JwtInterceptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class webConfig implements WebMvcConfigurer {
    @Autowired
    private JwtInterceptor jwtInterceptor;

    // 跨域（CORS）统一由 service 模块的 SecurityConfig 管理，这里不再单独配置，
    // 避免与 Spring Security 过滤器链冲突（原先写死 https://example.com 会拦截前端跨域）。

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(jwtInterceptor).addPathPatterns("/**")
                .excludePathPatterns(
                        "/auth/login",
                        // 刷新令牌：调用时机就是 access token 已过期，不能要求 Bearer；
                        // refresh token 走请求体，由 UsersServiceImpl.refresh 自行校验。
                        "/auth/refresh",
                        // 健康探针：调用方是 nginx / Kubernetes / 运维脚本，它们没有（也不该有）用户 token。
                        // 🔴 没有这一行，HealthController 的 /health/live 与 /health/ready 会一律返回 401 ——
                        //    本拦截器拦的是 /**，连"还没有 Controller 的路径"也会先被它拦下并直接 setStatus(401)，
                        //    症状是"契约文档里有样例、真机只有空 body 的 401"。2026-09-22 实测踩过。
                        // ⚠️ 放行的代价是这两个接口任何人都能调到（响应体里只有 up/down，不含内部信息），
                        //    契约 §15 把它们标注为「内网」权限，上线时靠网络层兜住。
                        "/health/**",
                        "/error",
                        // WebSocket 握手：浏览器原生 WebSocket API **带不了自定义请求头**，
                        // Authorization 在 STOMP CONNECT 帧头里（晚于 HTTP 握手）——
                        // 这里不放行，握手一律 401，前端推送通道永远连不上（症状：铃铛只有轮询、推送全无）。
                        // 令牌校验移到 STOMP 层：WebSocketConfig.configureClientInboundChannel 解 CONNECT 帧。
                        // ⚠️ 代价：握手段不校验 JWT（连接本身谁都能建）；用户队列靠 Principal 隔离，
                        //    未认证连接没有 Principal，convertAndSendToUser 找不到它 —— 收不到别人的单播。
                        // ⚠️ 两条都留：网关会剥掉 /api/v1 前缀，upstream 实际收到的是 /ws/**；
                        //    直连 8080 的场景才是 /api/v1/ws/**（2026-10-09）。
                        "/ws/**",
                        "/api/v1/ws/**",
                        "/v3/api-docs/**",
                        "/swagger-ui/**",
                        "/swagger-ui.html",
                        "/webjars/**"
                );
    }
}
