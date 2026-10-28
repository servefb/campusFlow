package com.campusflow.service.config;

import com.campusflow.tools.fileUtils.ClamAvScanner;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * ClamAV 扫描器装配。
 *
 * <p>把 {@link ClamAvScanner} 交给 Spring 容器管理，业务侧构造注入 / {@code @Autowired} 直接用，
 * 不用在代码里 {@code new}，也不再需要自己写 socket 连接（INSTREAM 协议由底层
 * {@code xyz.capybara:clamav-client} 库负责）。
 *
 * <p>⚠️ <b>别绕过 {@link ClamAvScanner} 直接注入库的 {@code ClamavClient}</b> ——
 * 那个库没有任何超时设置，直接用它会让扫描线程在 clamd 卡住时无限阻塞（详见 {@link ClamAvScanner} 类注释）。
 *
 * <p>配置项见 {@code application.yml} 的 {@code campus-flow.clamav} 段。
 *
 * @see ClamAvScanner
 */
@Slf4j
@Configuration
public class ClamAvConfig {

    /** clamd 主机。 */
    @Value("${campus-flow.clamav.host:192.168.150.100}")
    private String host;

    /** clamd 的 TCP 端口（INSTREAM 走这个端口，不是本地 unix socket）。 */
    @Value("${campus-flow.clamav.port:3310}")
    private int port;

    /**
     * 单次扫描超时（毫秒）。
     *
     * <p>🔴 不要省掉这个值 —— 底层库自己没有任何超时，靠的就是这一层。
     * 大文件扫描慢，默认给 60s。
     */
    @Value("${campus-flow.clamav.scan-timeout-ms:60000}")
    private int scanTimeoutMs;

    /** 并发扫描线程数。超过这个数的请求排队，排队时间计入上面的超时预算。 */
    @Value("${campus-flow.clamav.pool-size:4}")
    private int poolSize;

    /**
     * {@code destroyMethod = "close"} 会在应用关闭时收掉内部线程池，
     * 避免残留线程拖住优雅关闭。
     */
    @Bean(destroyMethod = "close")
    public ClamAvScanner clamAvScanner() {
        log.info("ClamAV 扫描器已装配：{}:{}（超时 {}ms，并发 {}）", host, port, scanTimeoutMs, poolSize);
        return new ClamAvScanner(host, port, scanTimeoutMs, poolSize);
    }
}
