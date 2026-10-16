package com.campusflow.tools.jwtutils;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Map;

@Component
public class JwtUtil {
    @Autowired
    private JwtProperties jwtProperties;

    /**
     * 由配置里的明文 secret 派生固定的签名密钥。
     * 注意：不要直接把字符串传给 jjwt 的 signWith/setSigningKey(String) 重载，
     * 那个重载要求 Base64 编码的密钥，明文会抛 IllegalArgumentException / WeakKeyException。
     * HS256 要求密钥字节 >= 32（默认配置 43 字符 >= 32，满足要求）。
     */
    private SecretKey getSigningKey() {
        return Keys.hmacShaKeyFor(jwtProperties.getSecret().getBytes(StandardCharsets.UTF_8));
    }

    public String createToken(Map<String, Object> claims ,Long expirationSeconds) {
        if (expirationSeconds == null || expirationSeconds <= 0) {
            throw new IllegalArgumentException("JWT expiration must be greater than zero seconds");
        }
        return Jwts.builder()
                .claims(claims)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + expirationSeconds * 1000L))
                .signWith(getSigningKey())
                .compact();
    }

    public Claims extractAllClaims(String token) {
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("JWT token must not be blank");
        }
        String normalizedToken = token.trim();
        if (normalizedToken.regionMatches(true, 0, "Bearer ", 0, 7)) {
            normalizedToken = normalizedToken.substring(7).trim();
        }
        return Jwts.parser()
                .verifyWith(getSigningKey())
                .build()
                .parseSignedClaims(normalizedToken)
                .getPayload();
    }
}
