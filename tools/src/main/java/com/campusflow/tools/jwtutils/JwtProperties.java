package com.campusflow.tools.jwtutils;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix ="campus-flow.jwt")
public class JwtProperties {
    private String secret;
    /** 令牌有效期（秒），对应配置 campus-flow.jwt.expiration-seconds */
    private Long expirationSeconds;
}
