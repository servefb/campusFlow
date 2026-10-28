package com.campusflow.service.config;

import com.xxl.job.core.executor.impl.XxlJobSpringExecutor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * XXL-JOB 执行器装配。
 *
 * <p>执行器是「被调度的那一端」：它启动后向调度中心（xxl-job-admin）注册，
 * 调度中心按 cron 派发任务、执行器跑 {@link com.campusflow.service.job.FileScanRetryJob} 里的 handler。
 * 本类只负责把 {@code xxl.job.*} 的配置喂给 {@link XxlJobSpringExecutor}。
 *
 * <h3>⚠️ 三个必须知道的部署事实</h3>
 * <ol>
 *   <li><b>版本必须与调度中心对齐</b>：调度中心是 {@code 192.168.150.100:8880} 上的 docker 容器
 *       {@code xuxueli/xxl-job-admin:3.5.0}，所以根 pom 的 {@code xxl-job.version} 锁在 {@code 3.5.0}。
 *       官方约束是「<b>调度中心版本 ≥ 执行器版本</b>」，两者走的是私有协议，不是 HTTP 兼容接口 ——
 *       执行器版本更高会注册不上（表现为 access token 校验失败或注册被直接拒绝，而配置看一眼全是对的）。
 *       想升执行器，先升调度中心，别只动一边。</li>
 *   <li><b>调度中心要单独部署</b>（xxl-job-admin，一个带 Web 界面的 Spring Boot 应用 + 它自己的 MySQL）。
 *       本工程只是「执行器」，不包含调度中心。没起 admin 时，执行器照样能启动、照样注册本地 handler，
 *       只是没人来派活 —— 把 {@code admin.addresses} 用环境变量显式置空就能回到这种「静默待命」状态。</li>
 *   <li><b>任务不是写代码就有了</b>：调度中心里要手工新建一条任务，JobHandler 填
 *       {@code fileScanRetryJob}（与 {@code @XxlJob} 的 value 一致），路由策略选
 *       <b>「分片广播」</b>，cron 例如 {@code 0 0/10 * * * ?}。少了这一步，代码再对也不会跑。</li>
 * </ol>
 *
 * <h3>为什么不用 {@code @Scheduled}</h3>
 * 补偿任务要扫全表找僵死记录，集群里每个实例都跑一遍就是重复劳动（还会并发重投同一条），
 * 而 XXL-JOB 的「分片广播」正好把这件事切成互不重叠的片：每个实例拿 {@code shardIndex/shardTotal}，
 * 各扫各的区间。见 {@link com.campusflow.service.job.FileScanRetryJob}。
 */
@Slf4j
@Configuration
public class XxlJobConfig {

    /** 是否启动执行器，默认启用。 */
    @Value("${xxl.job.enabled:true}")
    private boolean enabled;

    /** 与调度中心通讯的超时时间，单位秒。 */
    @Value("${xxl.job.admin.timeout:3}")
    private int timeout;

    /** 是否支持调度中心的 GLUE 任务，默认与 XXL-JOB 3.5.0 一致。 */
    @Value("${xxl.job.executor.glueEnabled:true}")
    private boolean glueEnabled;

    /** 调度中心地址，多个用逗号分隔。留空 = 不注册（执行器静默待命，不影响应用启动）。 */
    @Value("${xxl.job.admin.addresses:}")
    private String adminAddresses;

    /** 调度中心与执行器的通讯令牌，两端必须一致；留空则关闭鉴权。 */
    @Value("${xxl.job.accessToken:}")
    private String accessToken;

    /** 执行器名字。同一名字的多个实例构成一个集群，调度中心按它做路由。 */
    @Value("${xxl.job.executor.appname:campus-flow-executor}")
    private String appname;

    /** 执行器注册地址，留空则按 ip:port 自动生成。 */
    @Value("${xxl.job.executor.address:}")
    private String address;

    /** 执行器 IP，留空自动获取。多网卡机器必须显式指定，否则可能注册成一个调度中心连不上的网段地址。 */
    @Value("${xxl.job.executor.ip:}")
    private String ip;

    /** 执行器端口。同机多实例必须各不相同。 */
    @Value("${xxl.job.executor.port:9999}")
    private int port;

    @Value("${xxl.job.executor.logpath:./logs/xxl-job/jobhandler}")
    private String logPath;

    @Value("${xxl.job.executor.logretentiondays:30}")
    private int logRetentionDays;

    /**
     * 交给 Spring 托管，由它调用 {@code start()} / {@code destroy()}。
     *
     * <p>注意不要手工写 {@code destroyMethod}：{@link XxlJobSpringExecutor} 已经
     * implements {@code DisposableBean}，容器会自动调它的 {@code destroy()}。
     */
    @Bean
    public XxlJobSpringExecutor xxlJobExecutor() {
        XxlJobSpringExecutor executor = new XxlJobSpringExecutor();
        executor.setEnabled(enabled);
        executor.setAdminAddresses(adminAddresses);
        executor.setTimeout(timeout);
        executor.setGlueEnabled(glueEnabled);
        executor.setAccessToken(accessToken);
        executor.setAppname(appname);
        executor.setAddress(address);
        executor.setIp(ip);
        executor.setPort(port);
        executor.setLogPath(logPath);
        executor.setLogRetentionDays(logRetentionDays);
        log.info("装配 XXL-JOB 执行器：appname={}, port={}, 调度中心={}",
                appname, port, adminAddresses == null || adminAddresses.isBlank() ? "(未配置，不注册)" : adminAddresses);
        return executor;
    }
}
