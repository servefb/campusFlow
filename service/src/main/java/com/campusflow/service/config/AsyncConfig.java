package com.campusflow.service.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * 审计异步落库的线程池（全工程目前<b>唯一</b>的异步执行器）。
 *
 * <h3>为什么单独开池，而不是用 Spring Boot 默认的 applicationTaskExecutor</h3>
 * <ol>
 *   <li><b>隔离</b>：审计写入不能和别的异步任务抢线程。哪天有个慢任务把公共池占满，
 *       审计会跟着一起积压 —— 隔离之后它只受自己这一池的影响。</li>
 *   <li><b>可观测</b>：线程名前缀 {@code audit-log-}，jstack / 日志里一眼分得清是谁。</li>
 * </ol>
 * ⚠️ 副作用要知道：本工程现在<b>只有一个 {@code Executor} Bean</b>，
 * 于是它同时也是 {@code @Async} 的默认执行器 —— 将来谁写了个不带名字的 {@code @Async}，
 * 任务就会跑在审计池里。要区分的话，自己再加一个池并<b>显式命名</b>
 * （有两个 Executor Bean 时，不带名字的 {@code @Async} 会直接抛
 * {@code NoUniqueBeanDefinitionException}，等于强制命名，反而是好事）。
 *
 * <h3>三条决定可靠性的设置</h3>
 * <ul>
 *   <li><b>有界队列（默认 1000）+ {@link ThreadPoolExecutor.CallerRunsPolicy}</b>：
 *       队列满了不让它抛异常丢掉，而是<b>退回请求线程同步执行</b>。
 *       代价是那一次请求变慢，换来的是「审计一行都不丢」——旁路数据出问题时，
 *       宁可拖慢请求也不能静默缺行。这是本项目对审计的取舍。</li>
 *   <li><b>{@code waitForTasksToCompleteOnShutdown(true)} + {@code awaitTerminationSeconds}</b>：
 *       {@code ThreadPoolTaskExecutor} 是 Bean，容器关闭时会走 destroy，
 *       不设这两个的话在途的审计行会随进程一起消失（发布重启时最常见的丢日志原因）。
 *       ⚠️ 但仍有一种情况<b>会静默丢</b>：停机过程中<b>新进来</b>的请求，它的审计任务会被
 *       Spring 在 shutdown 阶段丢掉且不打错误日志（{@code lateShutdown} 的既定行为）。
 *       这不是 bug，硬要救就得放弃"等任务写完"，得不偿失 —— 知道有这么回事，别去追鬼。</li>
 *   <li><b>不要让线程池无限长</b>：队列有界，且 {@code maxPoolSize} 只在队列满时才扩线程
 *       （JDK {@code ThreadPoolExecutor} 的行为），所以这里的 max 实际只在压力峰值生效。</li>
 * </ul>
 *
 * <h3>配置项（都有默认值，不配也能跑）</h3>
 * 见 {@code application.yml} 的 {@code campus-flow.audit.async.*}。
 * ⚠️ 用 {@code @Value} 读取，因此是<b>精确匹配</b>键名（不做宽松绑定），键名写错会静默取到默认值。
 */
@Slf4j
@Configuration
@EnableAsync
public class AsyncConfig {

    /** 审计线程池的 Bean 名，同时也是 {@code @Async} 里的限定名。 */
    public static final String AUDIT_LOG_EXECUTOR = "auditLogExecutor";

    @Bean(AUDIT_LOG_EXECUTOR)
    public ThreadPoolTaskExecutor auditLogExecutor(
            @Value("${campus-flow.audit.async.core-pool-size:2}") int corePoolSize,
            @Value("${campus-flow.audit.async.max-pool-size:4}") int maxPoolSize,
            @Value("${campus-flow.audit.async.queue-capacity:1000}") int queueCapacity,
            @Value("${campus-flow.audit.async.await-termination-seconds:5}") int awaitTerminationSeconds) {

        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(corePoolSize);
        executor.setMaxPoolSize(maxPoolSize);
        executor.setQueueCapacity(queueCapacity);
        executor.setKeepAliveSeconds(60);
        executor.setThreadNamePrefix("audit-log-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(awaitTerminationSeconds);
        // 这里的 maxPoolSize 只在队列满时才会被用到（JDK 线程池的既定顺序：核心 → 队列 → 扩容 → 拒绝）
        log.info("[audit] 审计异步线程池已就绪: core={}, max={}, queue={}, 排队满则退回调用线程",
                corePoolSize, maxPoolSize, queueCapacity);
        return executor;
    }
}
