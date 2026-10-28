package com.campusflow.service.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * 健康探针的专用线程池（只被 {@code HealthServiceImpl} 使用）。
 *
 * <h3>为什么不复用 AsyncConfig 那个池</h3>
 * 那个池是审计落库专用的（有界队列 1000 + CallerRunsPolicy，"宁可慢也不丢审计行"）。
 * 两者的失败语义正好相反：审计是<b>不能丢</b>，探针是<b>不能拖</b>。
 * 混在一个池里，DB 抖动时探针会把审计线程占满，或者审计排队把探针堵死 ——
 * 而这两件事恰好会在同一个故障场景里同时发生（数据库出问题）。
 *
 * <h3>🔴 为什么必须有界 + AbortPolicy</h3>
 * 探针的底层调用（{@code DataSource#getConnection()}、MinIO 建立连接）<b>都可能长时间阻塞</b>，
 * 而 {@code CompletableFuture.orTimeout()} 的语义是「让<b>等待方</b>提前返回」，
 * <b>占住的池线程不会因此释放</b>。所以池一旦无限排队，一次数据库挂死就能让后续
 * 所有探针请求层层堆积，最后连"报告数据库挂了"这件事都做不到。
 * 这里 core = max = 4（正好四项）、队列 8、满了直接抛
 * {@link ThreadPoolExecutor.AbortPolicy} —— 被拒的项在 Service 里立即判 down，
 * 请求线程绝不阻塞，故障时探针始终能快速给出"部分 down"的真实答案。
 *
 * <h3>为什么关停时不等待在途任务</h3>
 * 探针任务没有任何需要保全的副作用，进程退出丢掉即可；等待只会拖慢优雅停机。
 */
@Configuration
public class HealthProbeConfig {

    /**
     * 探针线程池的 Bean 名。
     *
     * <p>🔴 注入端必须用 {@code @Qualifier(HealthProbeConfig.PROBE_EXECUTOR)} 点名：
     * 本工程有<b>两个</b> {@code ThreadPoolTaskExecutor} Bean（{@code AsyncConfig.auditLogExecutor}
     * 与这个），按类型注入会直接 {@code NoUniqueBeanDefinitionException}。
     * 这也是 {@code AsyncConfig} 类注释里预告过的那个副作用 —— 从此不带名字的
     * {@code @Async} 会启动失败，等于强制命名，是好事。
     */
    public static final String PROBE_EXECUTOR = "healthProbeExecutor";

    @Bean(PROBE_EXECUTOR)
    public ThreadPoolTaskExecutor healthProbeExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(8);
        executor.setThreadNamePrefix("health-probe-");
        // 满了就拒，绝不退回调用线程同步执行 —— 退回同步等于把探针接口重新拖慢，
        // 那正是这个池存在的意义所在。
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(false);
        executor.initialize();
        return executor;
    }
}
