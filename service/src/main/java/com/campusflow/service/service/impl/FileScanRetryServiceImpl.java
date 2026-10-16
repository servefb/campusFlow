package com.campusflow.service.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.campusflow.common.constant.FileConstant;
import com.campusflow.common.constant.RabbitMqConstant;
import com.campusflow.service.entity.dto.FileScanMessage;
import com.campusflow.service.entity.po.Files;
import com.campusflow.service.mapper.FilesMapper;
import com.campusflow.service.service.IFileScanRetryService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * {@link IFileScanRetryService} 的实现：查询僵死 → 切片 → 筛选 → 重投。
 *
 * <p>三条跳过规则的语义见 {@link IFileScanRetryService} 的类注释，这里只写怎么做到。
 *
 * <h3>为什么用 {@code @Service}（而 {@code FileScanServiceImpl} 用的是 {@code @Bean}）</h3>
 * 那个类的构造器里有一个 {@code List<Moderation>}，必须靠手工装配锁定审核链顺序（见
 * {@code ModerationConfig} 的注释）；这个类的依赖只有 {@code FilesMapper} 和
 * {@code RabbitTemplate}，没有多值依赖，走组件扫描最省事。
 *
 * <h3>为什么把 {@code stale} 判据交给数据库算</h3>
 * 用 {@code updated_at < DATE_SUB(NOW(3), INTERVAL ? MINUTE)}，而不是在 Java 里算
 * {@code LocalDateTime.now().minusMinutes(...)} 再传进来 —— 后者的正确性依赖
 * JVM 时区、JDBC 时区参数和 MySQL 会话时区三者一致，一旦不一致就是「全表都是僵死的」
 * 或者「一条都扫不到」这种很难归因的故障。让 DB 自己跟自己比，没这个风险。
 *
 * <h3>补偿次数存在哪</h3>
 * {@code files} 表没有重试次数字段（加列要改 DDL 与接口文档），所以借用
 * {@code scan_result.compensation = {attempts, last_attempt_at}}。
 * 这个位置是安全的：{@code markScanning} 不覆盖 {@code scan_result}（传 null），
 * 而扫完（{@code markReady}/{@code markRejected}）会用新结果整体覆盖 —— 计数自然归零，
 * 正是我们要的语义。
 *
 * @see com.campusflow.service.job.FileScanRetryJob 调度入口
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FileScanRetryServiceImpl implements IFileScanRetryService {

    /** {@code scan_result} 里放补偿元数据的键。 */
    private static final String COMPENSATION_KEY = "compensation";

    /** {@code scan_result} 里程序判读用的失败码键，与 FileScanServiceImpl 组装时一致。 */
    private static final String REASON_CODE_KEY = "reason_code";

    /**
     * 🔴 <b>重投也不会改变结论</b>的失败码 —— 补偿必须跳过。
     *
     * <p>{@code needs_review}（审核器给不出结论）和 {@code content_truncated}（只审了截断的那段）
     * 都是 {@code FileScanServiceImpl} 在「审过了但没有定论」时主动判的，出路是<b>人</b>，
     * 不是再来一次。它们的状态同样是 {@code scanning}，所以会被查询捞到 —— 必须在这里挡掉。
     */
    private static final Set<String> HUMAN_REVIEW_CODES = Set.of("needs_review", "content_truncated");

    private static final ObjectMapper JSON = new ObjectMapper();

    private final FilesMapper filesMapper;
    private final RabbitTemplate rabbitTemplate;

    /** 判定僵死的静默时长。要大于单次扫描的最坏耗时（含 TMS 切片串行 + clamd 超时）。 */
    @Value("${campus-flow.scan.retry.stale-minutes:30}")
    private int staleMinutes;

    /** 同一条记录最多被补偿重投几次。用完就不再自动重试，改为报错等人看。 */
    @Value("${campus-flow.scan.retry.max-attempts:3}")
    private int maxAttempts;

    /** 单批取多少条。批与批之间用主键游标推进，不是一次把候选全捞进内存。 */
    @Value("${campus-flow.scan.retry.batch-size:200}")
    private int batchSize;

    /** 单次调度最多处理多少条，防止一个分片跑太久把下一次调度堵在后面。 */
    @Value("${campus-flow.scan.retry.max-scan-per-run:2000}")
    private int maxScanPerRun;

    @Override
    public RetryReport retryStale(int shardIndex, int shardTotal) {
        if (shardTotal <= 0 || shardIndex < 0 || shardIndex >= shardTotal) {
            // 调度中心配错路由策略（比如选了「第一个」而不是「分片广播」）时，
            // 参数会是 index=0/total=1，那是合法的；越界就说明真有问题，早点炸出来。
            throw new IllegalArgumentException(
                    "分片参数非法：shardIndex=" + shardIndex + ", shardTotal=" + shardTotal);
        }

        IdRange range = shardRange(shardIndex, shardTotal);
        if (range == null) {
            log.info("本分片没有候选区间，无事可做：分片 {}/{}", shardIndex, shardTotal);
            return RetryReport.none();
        }

        log.info("开始补偿僵死扫描：分片 {}/{}，id 区间 [{}, {}]，僵死阈值 {} 分钟",
                shardIndex, shardTotal, range.from(), range.to(), staleMinutes);

        int candidates = 0;
        int requeued = 0;
        int skippedHuman = 0;
        int skippedOverLimit = 0;
        int requeueFailed = 0;

        long cursor = range.from();
        while (cursor <= range.to() && candidates < maxScanPerRun) {
            List<Files> batch = fetchBatch(cursor, range.to());
            if (batch.isEmpty()) {
                break;
            }

            for (Files f : batch) {
                candidates++;
                Map<String, Object> result = parse(f.getScanResult());
                String code = str(result.get(REASON_CODE_KEY));

                // 规则① 等人工的不重投
                if (HUMAN_REVIEW_CODES.contains(code)) {
                    skippedHuman++;
                    continue;
                }

                // 规则② 次数上限
                int attempts = attemptsOf(result);
                if (attempts >= maxAttempts) {
                    skippedOverLimit++;
                    // 这条日志是运维要找的：某条记录已经把机会用完了，
                    // 大概率是背后的基础设施（clamd / MinIO / TMS）还没恢复。
                    log.error("扫描僵死且补偿次数用尽，已停止自动重投，需人工介入："
                                    + "fileId={}, reasonCode={}, attempts={}/{}",
                            f.getId(), code, attempts, maxAttempts);
                    continue;
                }

                // 规则③ 先记账再投递
                if (requeue(f.getId(), result, attempts + 1)) {
                    requeued++;
                } else {
                    requeueFailed++;
                }
            }

            cursor = batch.get(batch.size() - 1).getId() + 1;
            if (batch.size() < batchSize) {
                break;
            }
        }

        RetryReport report = new RetryReport(candidates, requeued, skippedHuman, skippedOverLimit, requeueFailed);
        log.info("补偿僵死扫描完成：分片 {}/{}，{}", shardIndex, shardTotal, report.describe());
        return report;
    }

    // ---------- 切片 ----------

    /**
     * 把「所有僵死记录」的主键范围按分片数等分，返回本分片负责的闭区间。
     *
     * <p>取模切片（{@code WHERE MOD(id, n) = i}）写起来更短，但它没法走索引 ——
     * 每个分片都得全表扫一遍。用主键区间则可以吃到 {@code PRIMARY} 上的范围扫描，
     * 配合 {@code idx_files_status_updated} 后代价只和「僵死条数」有关。
     *
     * @return 本分片要处理的区间；没有僵死记录、或分片数多于记录数导致本片无区间时返回 {@code null}
     */
    private IdRange shardRange(int shardIndex, int shardTotal) {
        List<Map<String, Object>> rows = filesMapper.selectMaps(
                staleWrapper().select("MIN(id) AS minId", "MAX(id) AS maxId"));
        if (rows == null || rows.isEmpty()) {
            return null;
        }

        // 🔴 没有僵死记录时，MIN/MAX 聚合仍会返回「一行全 NULL」，而 MyBatis 对
        // 全 NULL 的行会给一个 null 元素（returnInstanceForEmptyRow 默认 false）——
        // rows 非空但 rows.get(0) 是 null，直接 .get() 就是 NPE。
        Map<String, Object> row = rows.isEmpty() ? null : rows.get(0);
        if (row == null) {
            return null;
        }
        // 别名同时兼容下划线/驼峰两种返回（MyBatis-Plus 对 Map 结果是否做驼峰转换与版本有关）
        Long min = num(row, "minId", "min_id");
        Long max = num(row, "maxId", "max_id");
        if (min == null || max == null) {
            return null;
        }

        long total = max - min + 1;
        // 向上取整；再兜一个下限 1 —— 候选数比分片数还少时，total/shardTotal 会是 0
        long span = Math.max(1L, (total + shardTotal - 1) / shardTotal);
        long from = min + span * shardIndex;
        if (from > max) {
            return null;
        }
        long to = Math.min(from + span - 1, max);
        return new IdRange(from, to);
    }

    /** 单批查询：只取需要的三列，靠主键区间 + 状态 + 静默时长过滤。 */
    private List<Files> fetchBatch(long from, long to) {
        return filesMapper.selectList(new QueryWrapper<Files>()
                .select("id", "scan_result", "updated_at")
                .eq("status", FileConstant.SCANNING)
                .apply("updated_at < DATE_SUB(NOW(3), INTERVAL {0} MINUTE)", staleMinutes)
                .ge("id", from)
                .le("id", to)
                .orderByAsc("id")
                // batchSize 是 int 配置项，拼不出注入；用 last() 是因为
                // MyBatis-Plus 的 Wrapper 没有传 LIMIT 参数的入口
                .last("LIMIT " + batchSize));
    }

    /** 僵死候选的公共条件，min/max 与批量查询必须一致，否则切片的区间会算歪。 */
    private QueryWrapper<Files> staleWrapper() {
        return new QueryWrapper<Files>()
                .eq("status", FileConstant.SCANNING)
                .apply("updated_at < DATE_SUB(NOW(3), INTERVAL {0} MINUTE)", staleMinutes);
    }

    // ---------- 重投 ----------

    /**
     * 记一次补偿尝试，然后把 fileId 重新投回扫描队列。
     *
     * @return 是否投递成功。{@code false} 表示次数<b>已经消耗</b>但消息没发出去（见下）
     */
    private boolean requeue(long fileId, Map<String, Object> result, int attempt) {
        // 🔴 顺序不能反。先投后记的话，「投递成功但进程随即被 kill」会让次数永远不加，
        // 下一轮调度又投一次 —— 就成了无界重投，规则②形同虚设。
        // 反过来的代价是「投递失败也消耗一次机会」，这是刻意选的保守方向：宁可少投，不可滥投。
        if (!bumpAttempt(fileId, result, attempt)) {
            return false;
        }

        try {
            // 与 FilesServiceImpl 上传后那次投递必须完全一致（三参数重载 + 同一 exchange/routingKey）。
            // ⚠️ 别写成两参数 convertAndSend(routingKey, payload)：那是「默认交换机 + routingKey」，
            // 而默认交换机只按队列名精确匹配，"campusflowFilekey" 是 routingKey，消息会被静默丢弃。
            rabbitTemplate.convertAndSend(
                    RabbitMqConstant.FILE_SCAN_EXCHANGE,
                    RabbitMqConstant.FILE_CAMPUSFLOW_ROUTING_KEY,
                    new FileScanMessage(fileId));
            log.info("已重投扫描任务：fileId={}, 第 {} 次补偿", fileId, attempt);
            return true;
        } catch (Exception e) {
            log.error("补偿重投失败（计数已消耗）：fileId={}, 第 {} 次补偿", fileId, attempt, e);
            return false;
        }
    }

    /**
     * 把 {@code scan_result.compensation.attempts} 加一并写回。
     *
     * <p>只 patch {@code scan_result} 一列，<b>不动 {@code status}</b> —— 记录继续留在
     * {@code scanning}，由消费端扫描开始时自己推进状态机（{@code markScanning}）。
     * 这样即使重投出去的消息又丢了，下一轮补偿还能再次捞到它。
     */
    private boolean bumpAttempt(long fileId, Map<String, Object> result, int attempt) {
        Map<String, Object> compensation = new LinkedHashMap<>();
        Object existing = result.get(COMPENSATION_KEY);
        if (existing instanceof Map<?, ?> m) {
            m.forEach((k, v) -> compensation.put(String.valueOf(k), v));
        }
        compensation.put("attempts", attempt);
        compensation.put("last_attempt_at", OffsetDateTime.now().toString());
        result.put(COMPENSATION_KEY, compensation);

        Files patch = new Files().setId(fileId).setScanResult(toJson(result));
        int rows = filesMapper.updateById(patch);
        if (rows == 0) {
            // 与 FileScanRepository.write 同样的坑：updateById 匹配不到行时返回 0 而不抛异常。
            // 行没了（被删）就什么都写不进去，留痕即可，别投递（投了也没人认领）。
            log.error("补偿计数写回失败（影响行数为 0，该行已被删除？）：fileId={}", fileId);
            return false;
        }
        return true;
    }

    // ---------- 小工具 ----------

    private static Map<String, Object> parse(String json) {
        if (json == null || json.isBlank()) {
            return new LinkedHashMap<>();
        }
        try {
            Map<String, Object> parsed = JSON.readValue(json, new TypeReference<Map<String, Object>>() {
            });
            return parsed == null ? new LinkedHashMap<>() : parsed;
        } catch (Exception e) {
            // 解析不了不能当成「没有失败码」就重投 —— 那可能是在反复重投一条已经被拒的文件。
            // 这里返回空 Map 后，attempts 会算成 0（继续尝试，有上限兜着），但会留下 WARN。
            log.warn("scan_result 不是合法 JSON，按空对象处理：{}", json, e);
            return new LinkedHashMap<>();
        }
    }

    private static int attemptsOf(Map<String, Object> result) {
        Object compensation = result.get(COMPENSATION_KEY);
        if (compensation instanceof Map<?, ?> m) {
            Object attempts = m.get("attempts");
            if (attempts instanceof Number n) {
                return n.intValue();
            }
        }
        return 0;
    }

    private static String toJson(Map<String, Object> result) {
        try {
            return JSON.writeValueAsString(result);
        } catch (JsonProcessingException e) {
            log.error("补偿元数据序列化失败", e);
            return "{\"reason_code\":\"compensation_serialize_failed\"}";
        }
    }

    /** 按候选键取数（别名驼峰/下划线都认），取不到返回 {@code null}。 */
    private static Long num(Map<String, Object> row, String... keys) {
        if (row == null) {
            return null;
        }
        for (String key : keys) {
            Object value = row.get(key);
            if (value instanceof Number n) {
                return n.longValue();
            }
        }
        return null;
    }

    private static String str(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    /** 本分片负责的主键闭区间。 */
    private record IdRange(long from, long to) {
    }
}
