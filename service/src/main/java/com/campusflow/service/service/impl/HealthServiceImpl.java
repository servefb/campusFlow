package com.campusflow.service.service.impl;

import com.campusflow.common.response.Result;
import com.campusflow.service.config.HealthProbeConfig;
import com.campusflow.service.entity.vo.HealthLiveVo;
import com.campusflow.service.entity.vo.HealthReadyVo;
import com.campusflow.service.service.IHealthService;
import io.minio.BucketExistsArgs;
import io.minio.MinioClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/**
 * 健康检查实现（契约 §A.10.1 / §A.10.2）。
 *
 * <h3>为什么不用 spring-boot-starter-actuator</h3>
 * actuator 其实<b>已经在依赖里</b>（{@code service/pom.xml}），实测
 * {@code GET /actuator/health} 也是通的。但它给不了契约要的形状，两个硬伤：
 * <ol>
 *   <li><b>响应结构不同</b>：actuator 回 {@code {"status":"UP","components":{...}}}，
 *       而契约要 {@code {code, message, data:{status, checks:{...}, timestamp}}}。
 *       要套上去就得再写一个 {@code ResponseBodyAdvice} 硬改形状，比直接写还绕。</li>
 *   <li><b>给不出两条路径</b>：actuator 只有一个聚合端点，而契约要
 *       {@code /health/live} 与 {@code /health/ready} 严格分开 —— 这个区分是有意义的
 *       （见 {@link HealthLiveVo} 的类注释：live 探依赖会把小故障放大成雪崩）。</li>
 * </ol>
 * actuator 保留原样不动。⚠️ 但要知道 {@code /actuator/health} 目前<b>不受
 * {@code JwtInterceptor} 拦</b>（实测免鉴权可达）—— 现在只泄露一个 UP/DOWN 还好，
 * 谁要是打开了 {@code management.endpoint.health.show-details}，组件细节就全出去了。
 *
 * <h3>探测方式的选择理由</h3>
 * <ul>
 *   <li><b>mysql</b>：从业务在用的 Hikari 池里取连接再 {@code isValid()}。
 *       走的正是业务请求用的那条路径，所以它绿就代表"业务能查库"，
 *       而不是"某个独立的探测连接能连上"。</li>
 *   <li><b>object_storage</b>：{@code bucketExists(默认桶)}，比 {@code listBuckets()}
 *       轻，而且顺带验证了配置里那个桶本身还在（桶被删了业务照样挂）。</li>
 *   <li><b>agent_gateway</b>：HTTP 打 AI 服务的 {@code GET /health}（要求 2xx）。
 *       ⚠️ 这里<b>必须</b>是 Python 侧白名单里的路径 —— 此前白名单只有
 *       {@code /login} 与 {@code /register}，连 {@code /docs} 都要 token，
 *       所以那时只能判"TCP 连得上"（401 也算活），判不了"能不能干活"。
 *       为此在 Python 仓补了 {@code /health} 并加进白名单，这一项才硬起来。</li>
 *   <li><b>fulltext_index</b>：查 {@code information_schema.STATISTICS} 里
 *       {@code knowledge_sections} 上有没有 <b>{@code INDEX_TYPE='FULLTEXT'}</b> 的索引。
 *       🔴 刻意<b>不按索引名</b>（{@code idx_knowledge_sections_text_fulltext}）匹配：
 *       绑名字的话，索引重建改名就会误报 down，而"检索能力还在不在"跟它叫什么无关。
 *       库里也没有"已建索引"的标记位可查 —— 那个索引由 MySQL 自动维护、全表都在里面。</li>
 * </ul>
 *
 * <h3>并发与超时（这段别改坏）</h3>
 * <ol>
 *   <li>四项<b>先全部提交、再统一取结果</b>。若写成"提交一项 → {@code join} 一项"，
 *       就退化成串行，最坏耗时是四项之和。</li>
 *   <li>单项超时 {@value #PROBE_TIMEOUT_MS}ms、由
 *       {@code CompletableFuture.orTimeout} 兜底。⚠️ 它只能让<b>等待方</b>提前返回，
 *       <b>不会释放卡在 {@code getConnection()} 里的池线程</b> —— 所以真正防堆积靠的是
 *       {@code HealthProbeConfig} 里那个有界池 + AbortPolicy（满了立即判 down）。</li>
 *   <li><b>复用全局 RestClient（{@code RestClientConfig}）是不行的</b>：它的超时是
 *       连接 5s / 读 10s，探针最坏会被拖到 15 秒，K8s 早判超时了。
 *       这里用 JDK 自带的 {@link HttpClient}（无新依赖），连接 1s、请求
 *       {@value #PROBE_TIMEOUT_MS}ms，并复用一个实例（它线程安全、自带连接池）。</li>
 * </ol>
 *
 * <h3>🔴 这里绝不能往外抛异常</h3>
 * 探针返回 5xx 是最糟的失败模式：运维看到 500 分不清是"被探的服务挂了"还是
 * "探针自己挂了"。所有探测方法都是 {@code try/catch → down}，
 * {@link #ready()} 也只用 {@code join()}（异常已在 {@code exceptionally} 里吃掉）。
 *
 * @see com.campusflow.service.controller.HealthController
 * @author JIA
 * @since 2026-09-22
 */
@Slf4j
@Service
public class HealthServiceImpl implements IHealthService {

    /** 单项探测结果：正常。契约样例里四项都是这个值。 */
    private static final String UP = "up";

    /** 单项探测结果：不可用。契约未定义，按 {@link #UP} 对称补的。 */
    private static final String DOWN = "down";

    /** {@code /health/live} 里的服务标识，与 actuator 的 {@code spring.application.name} 区分开（那是 campus-flow）。 */
    private static final String SERVICE_NAME = "campus-flow-api";

    /**
     * 单项探测超时（毫秒）。
     *
     * <p>取值依据：健康探针的消费者（K8s 默认 {@code timeoutSeconds=1}、nginx
     * {@code health_check} 默认 2s）都等不了太久；而四次探测是并行的，
     * 所以这里是最坏响应时间，不是总和。四倍留白给够机器抖动，又不至于让探针
     * 自己变成慢接口。
     */
    static final long PROBE_TIMEOUT_MS = 1500L;

    /** 全文检索所在的表 —— 与建表脚本里的字面量一致。 */
    private static final String FULLTEXT_TABLE = "knowledge_sections";

    /**
     * 输出时区。
     *
     * <p>与 {@code AdminMetricsServiceImpl} 同一取舍：数据源 JDBC URL 里写死了
     * {@code serverTimezone=Asia/Shanghai}，这里用同一个时区贴偏移量，
     * 🔴 不要换成 {@code ZoneId.systemDefault()} —— 服务器 TZ 一变，探针时间戳就跟着漂。
     */
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    /**
     * AI 服务 {@code GET /health} 探针用的 HTTP 客户端。
     *
     * <p>{@link HttpClient} 是线程安全的且自带连接池，所以整个 Bean 共用一个实例，
     * 不要每次探测都新建（那会丢掉连接复用，探针反而更慢）。
     * 超时设在这里是必须在构造时定的，没法按请求改连接超时。
     */
    private final HttpClient probeHttpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(1000))
            // 不跟随重定向：3xx 说明打到了别的东西，对探针而言应当算异常
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    private final DataSource dataSource;
    private final MinioClient minioClient;
    private final ThreadPoolTaskExecutor healthProbeExecutor;

    /** 与 {@code MinioConfig} 读同一个键 —— 两处必须一致，改一处等于改两处。 */
    @Value("${minio.bucket-name}")
    private String bucketName;

    /** AI 服务地址，与 {@code RestClientConfig} 指向同一个服务（那份是给业务用的，超时不同）。 */
    @Value("${campus-flow.ai.base-url}")
    private String aiBaseUrl;

    /**
     * 显式写构造器而不是 {@code @RequiredArgsConstructor}：本工程有<b>两个</b>
     * {@code ThreadPoolTaskExecutor} Bean（审计池 + 探针池），必须靠 {@link Qualifier}
     * 点名。Lombok 默认不会把 {@code @Qualifier} 复制到生成的构造器参数上，
     * 用注解版会变成"按类型注入 → 找到两个 → 启动报 NoUniqueBeanDefinitionException"。
     */
    public HealthServiceImpl(DataSource dataSource,
                             MinioClient minioClient,
                             @Qualifier(HealthProbeConfig.PROBE_EXECUTOR) ThreadPoolTaskExecutor healthProbeExecutor) {
        this.dataSource = dataSource;
        this.minioClient = minioClient;
        this.healthProbeExecutor = healthProbeExecutor;
    }

    @Override
    public Result<HealthLiveVo> live() {
        // 刻意什么都不探：见 HealthLiveVo 的类注释（live 探依赖会把小故障放大成雪崩）
        HealthLiveVo vo = new HealthLiveVo();
        vo.setStatus(UP);
        vo.setService(SERVICE_NAME);
        vo.setTimestamp(now());
        return new Result<HealthLiveVo>().success(vo);
    }

    @Override
    public Result<HealthReadyVo> ready() {
        // ① 先全部提交 —— 顺序提交会退化成串行（每个 submit 都要等上一个 future 才算完）
        CompletableFuture<String> mysqlFuture = submitProbe("mysql", this::probeMysql);
        CompletableFuture<String> storageFuture = submitProbe("object_storage", this::probeObjectStorage);
        CompletableFuture<String> gatewayFuture = submitProbe("agent_gateway", this::probeAgentGateway);
        CompletableFuture<String> fulltextFuture = submitProbe("fulltext_index", this::probeFulltextIndex);

        // ② 再统一取结果（此刻四项早已在并行跑）
        HealthReadyVo.Checks checks = new HealthReadyVo.Checks();
        checks.setMysql(mysqlFuture.join());
        checks.setObject_storage(storageFuture.join());
        checks.setAgent_gateway(gatewayFuture.join());
        checks.setFulltext_index(fulltextFuture.join());

        boolean allUp = UP.equals(checks.getMysql())
                && UP.equals(checks.getObject_storage())
                && UP.equals(checks.getAgent_gateway())
                && UP.equals(checks.getFulltext_index());

        HealthReadyVo vo = new HealthReadyVo();
        vo.setStatus(allUp ? HealthReadyVo.STATUS_READY : HealthReadyVo.STATUS_NOT_READY);
        vo.setChecks(checks);
        vo.setTimestamp(now());

        if (!allUp) {
            // ⚠️ 这条 WARN 是唯一的失败线索 —— 响应体里刻意不给失败原因（免鉴权接口不泄露内部信息，见 IHealthService 注释）
            log.warn("健康检查未就绪：mysql={}, object_storage={}, agent_gateway={}, fulltext_index={}",
                    checks.getMysql(), checks.getObject_storage(),
                    checks.getAgent_gateway(), checks.getFulltext_index());
        }

        return new Result<HealthReadyVo>().success(vo);
    }

    /**
     * 把单个探测提交到探针线程池，并保证<b>永远返回一个结果</b>（超时或线程池拒绝都算 down）。
     *
     * <p>⚠️ {@code supplyAsync} 是<b>立即提交</b>的，而池满时 {@code ThreadPoolExecutor}
     * 会当场抛 {@link RejectedExecutionException}（AbortPolicy）—— 必须在这里接住，
     * 否则它会冒到 {@link #ready()} 里把整个探针接口变成 500。
     */
    private CompletableFuture<String> submitProbe(String name, Supplier<String> probe) {
        try {
            return CompletableFuture
                    .supplyAsync(probe, healthProbeExecutor)
                    .orTimeout(PROBE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                    .exceptionally(ex -> {
                        log.warn("健康检查：{} 未在 {}ms 内完成 → 判 down（{}）",
                                name, PROBE_TIMEOUT_MS, ex.toString());
                        return DOWN;
                    });
        } catch (RejectedExecutionException e) {
            log.warn("健康检查：{} 探测被拒（探针线程池已满）→ 立即判 down", name);
            return CompletableFuture.completedFuture(DOWN);
        }
    }

    /** 主库连通性。用业务同一个连接池，绿 = 业务能查库。 */
    private String probeMysql() {
        try (Connection connection = dataSource.getConnection()) {
            // 1 秒是 JDBC 规范里 isValid 的超时参数（秒）
            return connection.isValid(1) ? UP : DOWN;
        } catch (Exception e) {
            log.warn("健康检查：mysql 探测失败（{}）", e.toString());
            return DOWN;
        }
    }

    /** 对象存储可用性 —— 查默认桶在不在，比 listBuckets 轻。 */
    private String probeObjectStorage() {
        try {
            boolean exists = minioClient.bucketExists(
                    BucketExistsArgs.builder().bucket(bucketName).build());
            if (!exists) {
                log.warn("健康检查：object_storage 探测失败：桶 {} 不存在", bucketName);
                return DOWN;
            }
            return UP;
        } catch (Exception e) {
            // MinIO SDK 的 bucketExists 会抛出一长串受检异常，这里统一按不可用处理
            log.warn("健康检查：object_storage 探测失败（{}）", e.toString());
            return DOWN;
        }
    }

    /**
     * 模型网关可用性 —— HTTP 探 AI 服务的 {@code /health}，要求 2xx。
     *
     * <p>⚠️ 与另外三项不同，这一项依赖<b>另一个仓库</b>（Python AI 服务）里的一段白名单配置。
     * 那是刻意的：能让它变红的原因本来就该包括"AI 服务改了鉴权白名单"。
     */
    private String probeAgentGateway() {
        URI uri;
        try {
            uri = URI.create(joinUrl(aiBaseUrl, "/health"));
        } catch (IllegalArgumentException e) {
            // 配错地址时给一条能定位的日志，而不是一句笼统的 down
            log.warn("健康检查：agent_gateway 探测失败：campus-flow.ai.base-url 不是合法地址（{}）", aiBaseUrl);
            return DOWN;
        }
        try {
            HttpRequest request = HttpRequest.newBuilder(uri)
                    .timeout(Duration.ofMillis(PROBE_TIMEOUT_MS))
                    .GET()
                    .build();
            HttpResponse<Void> response = probeHttpClient.send(request, HttpResponse.BodyHandlers.discarding());
            int statusCode = response.statusCode();
            if (statusCode >= 200 && statusCode < 300) {
                return UP;
            }
            log.warn("健康检查：agent_gateway 探测失败：{} 返回 HTTP {}", uri, statusCode);
            return DOWN;
        } catch (InterruptedException e) {
            // 中断标记必须还回去，否则这一项的失败会顺带吃掉整个请求线程的中断状态
            Thread.currentThread().interrupt();
            log.warn("健康检查：agent_gateway 探测被中断");
            return DOWN;
        } catch (Exception e) {
            log.warn("健康检查：agent_gateway 探测失败（连不上 {}）（{}）", uri, e.toString());
            return DOWN;
        }
    }

    /**
     * 全文检索可用性 —— {@code knowledge_sections} 上有没有 FULLTEXT 类型的索引。
     *
     * <p>🔴 按 {@code INDEX_TYPE} 而不是索引名匹配，理由见类注释。
     * <p>⚠️ {@code TABLE_SCHEMA = DATABASE()} 是必须的：不带它会把别的库里的同名表也算进来，
     * 那就会出现"本库没建索引但探针是绿的"这种最难查的假阳性。
     */
    private String probeFulltextIndex() {
        String sql = "SELECT 1 FROM information_schema.STATISTICS "
                + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_TYPE = 'FULLTEXT' LIMIT 1";
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, FULLTEXT_TABLE);
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    log.warn("健康检查：fulltext_index 探测失败：{}.{} 上没有 FULLTEXT 索引", FULLTEXT_TABLE, FULLTEXT_TABLE);
                    return DOWN;
                }
                return UP;
            }
        } catch (Exception e) {
            log.warn("健康检查：fulltext_index 探测失败（{}）", e.toString());
            return DOWN;
        }
    }

    /**
     * 拼接 base-url 与路径，容错末尾多余的 {@code /}。
     *
     * <p>不做这一步的话，{@code http://host:8000/} + {@code /health} 会拼出
     * {@code //health} —— Tomcat/uvicorn 通常能容忍，但那是运气，不是保证。
     */
    private static String joinUrl(String baseUrl, String path) {
        if (baseUrl == null || baseUrl.isEmpty()) {
            throw new IllegalArgumentException("base-url 为空");
        }
        return (baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl) + path;
    }

    /** 当前时刻，东八区、截到秒 —— 与契约样例 {@code 2026-09-04T16:00:00+08:00} 同一种格式。 */
    private static OffsetDateTime now() {
        return OffsetDateTime.now(ZONE).truncatedTo(ChronoUnit.SECONDS);
    }
}
