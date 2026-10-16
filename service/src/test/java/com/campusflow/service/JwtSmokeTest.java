package com.campusflow.service;

import com.campusflow.tools.jwtutils.JwtProperties;
import com.campusflow.tools.jwtutils.JwtUtil;
import io.jsonwebtoken.Claims;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 隔离冒烟测试：不依赖 Spring / 数据库，直接验证 JwtUtil 签发与解析 token 全流程。
 */


class JwtSmokeTest {

    @Test
    void createAndParseToken() throws Exception {
        // 1. 构造与 application.yml 一致的属性（默认密钥 + 7200 秒）
        JwtProperties props = new JwtProperties();
        props.setSecret("campus-flow-local-secret-key-change-me-2026");
        props.setExpirationSeconds(7200L);

        // 2. 手动注入私有字段（等价于 Spring 的 @Autowired）
        JwtUtil util = new JwtUtil();
        Field f = JwtUtil.class.getDeclaredField("jwtProperties");
        f.setAccessible(true);
        f.set(util, props);

        // 3. 模拟登录时的 claim
        Map<String, Object> claim = new HashMap<>();
        claim.put("userId", 1001L);

        // 4. 签发 token —— 用户报错的位置
        String token = util.createToken(claim,props.getExpirationSeconds());
        System.out.println("GENERATED_TOKEN=" + token);
        assertNotNull(token);
        assertFalse(token.isBlank());

        // 5. 用同一密钥解析回读，验证签名与有效期
        Claims parsed = util.extractAllClaims(token);
        assertEquals(1001L, parsed.get("userId", Long.class).longValue());
        assertNotNull(parsed.getExpiration());
        System.out.println("PARSE_OK, expiresAt=" + parsed.getExpiration());
    }
}
