package com.campusflow.service.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 项目鉴权仍由 tools 模块的 JwtInterceptor（HandlerInterceptor）负责，
 * 这里仅引入 Spring Security 过滤器链来解决跨域预检（preflight OPTIONS）被默认策略拦截的问题。
 * 默认的 Spring Security 会开启 CSRF 且要求所有接口认证，导致 POST /auth/login 的预检直接 403。
 * <p>
 * CORS 与本模块保持一致，单一数据源在此处维护，避免与 webConfig#addCorsMappings 冲突。
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    /**
     * 允许的跨域来源，多个用英文逗号分隔。默认 "*" 表示原生模式（配合 allowCredentials=true 需要 allowedOriginPatterns）。
     * 可通过 application.yml 的 campus-flow.cors.allowed-origin-patterns 覆盖。
     */
    @Value("${campus-flow.cors.allowed-origin-patterns:*}")
    private String allowedOriginPatterns;

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                // 让 Spring Security 使用 CorsConfigurationSource 处理跨域（含预检）
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                // 关闭 CSRF：登录走 POST，且鉴权已由 JwtInterceptor 接管
                .csrf(AbstractHttpConfigurer::disable)
                // 关闭默认登录表单与 HTTP Basic
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                // 无状态会话，不创建 Session
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // 放行到 Spring MVC，真正的接口鉴权交给 JwtInterceptor
                .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        List<String> origins = Arrays.stream(allowedOriginPatterns.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toList());
        config.setAllowedOriginPatterns(origins);
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
