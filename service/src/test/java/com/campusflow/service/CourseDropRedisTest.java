package com.campusflow.service;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.connection.RedisPassword;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import java.util.List;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

/** Optional real-Redis checks; all data uses a unique test namespace and is removed afterwards. */
@EnabledIfEnvironmentVariable(named = "COURSE_DROP_REDIS_TEST", matches = "true")
class CourseDropRedisTest {
    private LettuceConnectionFactory factory;
    private StringRedisTemplate redis;
    private String prefix;
    private List<String> keys;
    private DefaultRedisScript<Long> script;

    @BeforeEach
    void setUp() {
        RedisStandaloneConfiguration config = new RedisStandaloneConfiguration(
                System.getenv("COURSE_TEST_REDIS_HOST"), 6379);
        config.setPassword(RedisPassword.of(System.getenv("COURSE_TEST_REDIS_PASSWORD")));
        var client = LettuceClientConfiguration.builder()
                .commandTimeout(java.time.Duration.ofSeconds(5))
                .shutdownTimeout(java.time.Duration.ZERO).build();
        factory = new LettuceConnectionFactory(config, client);
        factory.afterPropertiesSet();
        redis = new StringRedisTemplate(factory);
        prefix = "campusflow:test:drop:{" + UUID.randomUUID() + "}:";
        keys = List.of(prefix + "selected", prefix + "bitmap", prefix + "stock", prefix + "tmp");
        script = new DefaultRedisScript<>();
        script.setLocation(new ClassPathResource("lua/dropCourse.lua"));
        script.setResultType(Long.class);
        redis.opsForValue().set(keys.get(2), "7");
        redis.opsForSet().add(keys.get(0), "501", "502");
        redis.opsForValue().set(prefix + "offering:501", "a");
        redis.opsForValue().set(prefix + "offering:502", "c");
        redis.opsForValue().set(keys.get(1), "c");
    }

    @AfterEach
    void cleanUp() {
        if (redis != null) {
            redis.delete(List.of(keys.get(0), keys.get(1), keys.get(2), keys.get(3),
                    prefix + "offering:501", prefix + "offering:502"));
        }
        if (factory != null) factory.destroy();
    }

    private Long drop(String id) {
        return redis.execute(script, keys, id, prefix + "offering:");
    }

    @Test
    void rebuildsFromRemainingSelectionsAndReleasesOnlyOnce() {
        assertEquals(1L, drop("501"));
        assertEquals("8", redis.opsForValue().get(keys.get(2)));
        assertEquals("c", redis.opsForValue().get(keys.get(1)));
        assertFalse(redis.opsForSet().isMember(keys.get(0), "501"));
        assertTrue(redis.opsForSet().isMember(keys.get(0), "502"));
        assertEquals(0L, drop("501"));
        assertEquals("8", redis.opsForValue().get(keys.get(2)));
        assertFalse(redis.hasKey(keys.get(3)));
    }

    @Test
    void lastDropClearsStudentBitmap() {
        assertEquals(1L, drop("501"));
        assertEquals(1L, drop("502"));
        assertFalse(redis.hasKey(keys.get(1)));
        assertEquals("9", redis.opsForValue().get(keys.get(2)));
    }

    @Test
    void missingRemainingBitmapDoesNotPartiallyRelease() {
        redis.delete(prefix + "offering:502");
        assertEquals(-1L, drop("501"));
        assertTrue(redis.opsForSet().isMember(keys.get(0), "501"));
        assertEquals("7", redis.opsForValue().get(keys.get(2)));
        assertEquals("c", redis.opsForValue().get(keys.get(1)));
    }
}
