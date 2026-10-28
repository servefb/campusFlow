package com.campusflow.service.service.impl;

import com.campusflow.common.exception.BusinessException;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.vo.AdminMetricsAgentsVo;
import com.campusflow.service.entity.vo.AdminMetricsHotQuestionsVo;
import com.campusflow.service.entity.vo.AdminMetricsOverviewVo;
import com.campusflow.service.entity.vo.AdminMetricsTrendsVo;
import com.campusflow.service.entity.vo.KnowledgeHealthVo;
import com.campusflow.service.mapper.AdminMetricsMapper;
import com.campusflow.service.service.IAdminMetricsService;
import com.campusflow.service.support.AdminGuard;
import com.campusflow.service.support.MetricWindow;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 管理员看板指标实现。
 *
 * <h3>口径从哪来</h3>
 * SQL 与每条口径的理由全部写在 {@link AdminMetricsMapper} 的注释里，
 * 时间窗口的边界与分桶写在 {@link MetricWindow} 的注释里，这里只做
 * 「鉴权 → 取数 → 组装」。
 *
 * <h3>⚠️ 组装用的是普通 setter 而不是链式</h3>
 * {@link KnowledgeHealthVo} 以及本工程其它 VO 都只有 {@code @Data}
 * （没加 {@code @Accessors(chain = true)} —— 那是 PO 的风格），setter 返回 {@code void}，
 * 链式写法根本编不过。
 *
 * <h3>⚠️ 「没测到」一律回 null，不兜 0</h3>
 * 这是本组接口的<b>核心约定</b>：{@code average_response_ms = 0} 会被读成
 * 「响应时长 0 毫秒」，{@code helpful_rate = 0} 会被读成「一条好评都没有」。
 * 两者都是看着完全正常、实际是错的读数。计数类指标（提问数、待复核数）才可以为 0，
 * 因为「这一格确实没人提问」是一个真实事实。
 *
 * @see com.campusflow.service.controller.AdminMetricsController
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdminMetricsServiceImpl implements IAdminMetricsService {

    /**
     * 输出时区。
     *
     * <p>数据源 JDBC URL 里写死了 {@code serverTimezone=Asia/Shanghai}，所以从库里读出来的
     * {@code LocalDateTime} 就是东八区的墙上时间。这里用同一个时区把它贴成带偏移量的
     * {@code OffsetDateTime}（契约样例形如 {@code 2026-09-04T15:55:00+08:00}）。
     * ⚠️ 不要改成 {@code ZoneId.systemDefault()} —— 服务器 TZ 一变，看板时间就跟着漂。
     */
    private static final ZoneId ZONE = MetricWindow.ZONE;

    /** 高频榜默认条数（管理端那一卡叫「Top 5」）。 */
    private static final int DEFAULT_HOT_LIMIT = 5;

    /** 高频榜上限，防止有人用 {@code ?limit=100000} 打挂库。 */
    private static final int MAX_HOT_LIMIT = 50;

    /** `/trends` 允许的粒度取值。{@code range} 决定实际粒度，这里只挡拼错的值。 */
    private static final List<String> ALLOWED_INTERVAL = List.of("hour", "day");

    private final AdminMetricsMapper adminMetricsMapper;
    private final AdminGuard adminGuard;

    @Override
    public Result<KnowledgeHealthVo> getKnowledgeHealth() {
        adminGuard.requireAdmin();

        // 1) 文档状态计数（一次全表扫拿到 6 个状态桶 + removed 软删桶）
        Map<String, Object> counts = adminMetricsMapper.selectDocumentStatusCounts();
        KnowledgeHealthVo.Documents documents = new KnowledgeHealthVo.Documents();
        documents.setReady(number(counts, "ready"));
        documents.setProcessing(number(counts, "processing"));
        documents.setFailed(number(counts, "failed"));
        documents.setOffline(number(counts, "offline"));
        documents.setDraft(number(counts, "draft"));
        documents.setArchived(number(counts, "archived"));
        // removed = deleted_at IS NOT NULL（AI 服务移出知识库打的软删戳）；
        // 与六个状态桶互斥，不计入 total。
        documents.setRemoved(number(counts, "removed"));
        documents.setTotal(documents.getReady() + documents.getProcessing() + documents.getFailed()
                + documents.getOffline() + documents.getDraft() + documents.getArchived());

        // 2) 全文索引覆盖
        KnowledgeHealthVo.FulltextIndex fulltextIndex = new KnowledgeHealthVo.FulltextIndex();
        fulltextIndex.setIndexed_sections(adminMetricsMapper.countIndexedSections());
        fulltextIndex.setPending_sections(adminMetricsMapper.countPendingSections());
        // 没跑完过就是 null，前端渲染「—」。这里刻意不兜底成 now()/0：
        // 那会让看板显示一个假的「刚刚索引过」。
        fulltextIndex.setLast_completed_at(toOffset(adminMetricsMapper.selectLastFulltextIndexCompletedAt()));

        // 3) 待处理冲突
        long pendingConflicts = adminMetricsMapper.countPendingConflicts();

        KnowledgeHealthVo vo = new KnowledgeHealthVo();
        vo.setUpdated_at(now());
        // 四个板块全部来自实时查询，永远是完整的。置 false 的唯一场景是将来某板块降级
        // （例如向量指标依赖的外部服务不可用），届时前端会把缺失值渲染成「—」而不是 0。
        vo.setData_complete(true);
        vo.setDocuments(documents);
        vo.setFulltext_index(fulltextIndex);
        vo.setPending_conflicts(pendingConflicts);

        log.debug("知识库健康指标：documents={}, indexed={}, pending_sections={}, conflicts={}",
                documents.getTotal(), fulltextIndex.getIndexed_sections(),
                fulltextIndex.getPending_sections(), pendingConflicts);

        return new Result<KnowledgeHealthVo>().success(vo);
    }

    @Override
    public Result<AdminMetricsOverviewVo> getOverview(String range) {
        adminGuard.requireAdmin();
        MetricWindow window = MetricWindow.resolve(range);
        LocalDateTime from = window.from();
        LocalDateTime to = window.to();

        // ---- 当前窗口 ----
        long questionCount = adminMetricsMapper.countUserMessages(from, to);
        Double avgLatency = adminMetricsMapper.avgAssistantElapsed(from, to);
        long grounded = adminMetricsMapper.countGroundedAssistantMessages(from, to);
        long cited = adminMetricsMapper.countCitedAssistantMessages(from, to);
        Map<String, Object> feedback = adminMetricsMapper.selectFeedbackCounts(from, to);
        long feedbackTotal = number(feedback, "total");
        long feedbackHelpful = number(feedback, "helpful");
        long assistantTotal = adminMetricsMapper.countAssistantMessages(from, to);
        long routed = adminMetricsMapper.countRoutedAssistantMessages(from, to);

        // ---- 上一等长窗口（环比）----
        MetricWindow previous = window.previous();
        long prevQuestions = adminMetricsMapper.countUserMessages(previous.from(), previous.to());
        Double prevAvgLatency = adminMetricsMapper.avgAssistantElapsed(previous.from(), previous.to());

        AdminMetricsOverviewVo.Metrics metrics = new AdminMetricsOverviewVo.Metrics();
        metrics.setQuestion_count(questionCount);
        metrics.setAverage_response_ms(round(avgLatency));
        // 分母为 0 → null（「没测到」），不做 0 兜底：0% 命中率会被当成真的在漏引用
        metrics.setCitation_hit_rate(grounded == 0 ? null : (double) cited / (double) grounded);
        metrics.setHelpful_rate(feedbackTotal == 0 ? null : (double) feedbackHelpful / (double) feedbackTotal);
        metrics.setAuto_resolved_rate(assistantTotal == 0 ? null
                : (double) (assistantTotal - routed) / (double) assistantTotal);
        // 瞬时积压量，与 range 无关
        metrics.setHuman_review_pending(adminMetricsMapper.countPendingReviews());
        // 上一窗口为 0 时除法无意义 → null，前端不渲染环比角标
        metrics.setQuestion_count_delta(prevQuestions == 0 ? null
                : (double) (questionCount - prevQuestions) / (double) prevQuestions);
        metrics.setAverage_response_ms_delta(avgLatency == null || prevAvgLatency == null || prevAvgLatency == 0 ? null
                : (avgLatency - prevAvgLatency) / prevAvgLatency);

        AdminMetricsOverviewVo vo = new AdminMetricsOverviewVo();
        vo.setRange(window.range());
        vo.setInterval(window.interval());
        vo.setUpdated_at(now());
        vo.setData_complete(true);
        vo.setMetrics(metrics);

        log.debug("概览指标 range={} 提问={} 均耗时={}ms 引用命中={} 好评率={} 自主解决={}",
                window.range(), questionCount, metrics.getAverage_response_ms(),
                metrics.getCitation_hit_rate(), metrics.getHelpful_rate(), metrics.getAuto_resolved_rate());

        return new Result<AdminMetricsOverviewVo>().success(vo);
    }

    @Override
    public Result<AdminMetricsTrendsVo> getTrends(String range, String interval) {
        adminGuard.requireAdmin();
        // interval 只做取值校验：实际粒度由 range 决定（today→hour，其余→day）。
        // 遇到不认识的取值直接 400 —— 静默按小时返回，会让人以为「按分钟看不了」而不是「参数写错了」。
        if (interval != null && !interval.isBlank() && !ALLOWED_INTERVAL.contains(interval.trim())) {
            throw new BusinessException(400,
                    "不支持的采样粒度：" + interval.trim() + "（可选 hour / day）");
        }
        MetricWindow window = MetricWindow.resolve(range);
        LocalDateTime from = window.from();
        LocalDateTime to = window.to();
        String fmt = window.sqlBucketFormat();

        Map<String, Long> questions = toCountMap(adminMetricsMapper.selectUserBucketCounts(from, to, fmt), "cnt");
        Map<String, Long> latency = toRoundedMap(adminMetricsMapper.selectLatencyBucketAvgs(from, to, fmt), "avg_ms");

        // 两条分流线只在「窗口内真的开过工单」时才给 —— 否则它们只是
        // 「没有任何复核」的推论，画出来是一条贴地 0 的虚线，比单线更容易误判。
        boolean hasReviews = adminMetricsMapper.countReviewsInWindow(from, to) > 0;
        Map<String, Long> routed = hasReviews
                ? toCountMap(adminMetricsMapper.selectRoutedBucketCounts(from, to, fmt), "cnt")
                : Map.of();
        Map<String, Long> answers = hasReviews
                ? toCountMap(adminMetricsMapper.selectAssistantBucketCounts(from, to, fmt), "cnt")
                : Map.of();

        List<AdminMetricsTrendsVo.Item> items = new ArrayList<>();
        for (LocalDateTime bucketStart : window.bucketStarts()) {
            String label = window.label(bucketStart);
            AdminMetricsTrendsVo.Item item = new AdminMetricsTrendsVo.Item();
            item.setTime(label);
            // 没有记录 = 真实的 0（这一格确实没人问），不是缺失值
            item.setQuestion_count(questions.getOrDefault(label, 0L));
            // 没有耗时 = 未测到 → null（前端「—」），不是 0ms
            item.setAverage_response_ms(latency.get(label));
            if (hasReviews) {
                int routedCount = routed.getOrDefault(label, 0L).intValue();
                long answerCount = answers.getOrDefault(label, 0L);
                item.setHuman_routed(routedCount);
                item.setAi_resolved((int) Math.max(0L, answerCount - routedCount));
            }
            items.add(item);
        }

        AdminMetricsTrendsVo vo = new AdminMetricsTrendsVo();
        vo.setRange(window.range());
        vo.setInterval(window.interval());
        vo.setUpdated_at(now());
        vo.setData_complete(true);
        vo.setItems(items);
        return new Result<AdminMetricsTrendsVo>().success(vo);
    }

    @Override
    public Result<AdminMetricsAgentsVo> getAgents(String range) {
        adminGuard.requireAdmin();
        MetricWindow window = MetricWindow.resolve(range);

        List<Map<String, Object>> stats = adminMetricsMapper.selectAgentStats(window.from(), window.to());
        Map<Long, Long> p95ByAgent = toAgentP95Map(adminMetricsMapper.selectAgentP95(window.from(), window.to()));

        List<AdminMetricsAgentsVo.Item> items = new ArrayList<>();
        for (Map<String, Object> row : stats) {
            Long agentId = longOrNull(row, "agent_id");
            long callCount = number(row, "call_count");
            long failed = number(row, "failed_count");
            String agentKey = trimToNull(str(row, "agent_key"));

            AdminMetricsAgentsVo.Item item = new AdminMetricsAgentsVo.Item();
            // ⚠️ Agent 已被删除时 key 为空：回填 agent_<id> 而不是丢掉这一行 ——
            // 丢行会让「调用总量」对不上 agent_runs 的行数，而且没有任何提示
            item.setAgent_key(agentKey != null ? agentKey
                    : (agentId == null ? "unknown_agent" : "agent_" + agentId));
            item.setAgent_name(trimToNull(str(row, "agent_name")));
            item.setCall_count(callCount);
            // 分母 ≥ 1（能出现在结果里就至少有一次调用），所以这个率恒有值。
            // 给 null 会让管理端的加权总体失败率算成 NaN。
            item.setFailure_rate(callCount == 0 ? 0d : (double) failed / (double) callCount);
            item.setAverage_elapsed_ms(round(dbl(row, "avg_elapsed_ms")));
            item.setP95_elapsed_ms(agentId == null ? null : p95ByAgent.get(agentId));
            items.add(item);
        }

        AdminMetricsAgentsVo vo = new AdminMetricsAgentsVo();
        vo.setRange(window.range());
        vo.setInterval(window.interval());
        vo.setUpdated_at(now());
        vo.setData_complete(true);
        vo.setItems(items);
        return new Result<AdminMetricsAgentsVo>().success(vo);
    }

    @Override
    public Result<AdminMetricsHotQuestionsVo> getHotQuestions(String range, Integer limit) {
        adminGuard.requireAdmin();
        MetricWindow window = MetricWindow.resolve(range);

        int size = limit == null || limit < 1 ? DEFAULT_HOT_LIMIT : Math.min(limit, MAX_HOT_LIMIT);
        List<Map<String, Object>> rows = adminMetricsMapper.selectHotQuestions(window.from(), window.to(), size);

        List<AdminMetricsHotQuestionsVo.Item> items = new ArrayList<>();
        int rank = 1;
        for (Map<String, Object> row : rows) {
            String question = str(row, "question");
            if (question == null || question.isBlank()) {
                // SQL 里已经挡掉了纯空白，这里是第二道 —— 真出现空标题，
                // 榜单上会是一条没有内容的排名，比少一条更难看
                continue;
            }
            AdminMetricsHotQuestionsVo.Item item = new AdminMetricsHotQuestionsVo.Item();
            item.setRank(rank++);
            item.setQuestion(question);
            item.setCount(number(row, "cnt"));
            // category / helpful_rate 库中无事实来源，保持 null（见 VO 注释），
            // 管理端已改成「无值则不渲染那枚标签」
            items.add(item);
        }

        AdminMetricsHotQuestionsVo vo = new AdminMetricsHotQuestionsVo();
        vo.setRange(window.range());
        vo.setInterval(window.interval());
        vo.setUpdated_at(now());
        vo.setData_complete(true);
        vo.setItems(items);
        return new Result<AdminMetricsHotQuestionsVo>().success(vo);
    }

    // ------------------------------------------------------------------ 内部工具

    /** 当前时刻，东八区、截到秒 —— 契约样例是 {@code 2026-09-04T15:55:00+08:00}，无小数部分。 */
    private static OffsetDateTime now() {
        return OffsetDateTime.now(ZONE).truncatedTo(ChronoUnit.SECONDS);
    }

    /**
     * 库里的 LocalDateTime（东八区墙上时间）→ 带偏移量的 OffsetDateTime，截到秒。
     *
     * <p>截秒是为了与 {@code updated_at} 保持同一种格式：契约 §A.9.4 样例里的两个时间戳
     * 都是 {@code 2026-09-04T15:50:00+08:00} 这种秒精度。库列是 {@code datetime(3)}，
     * 截掉毫秒确实丢精度，但毫秒对「最近一次索引完成时刻」这个语义没有价值，
     * 而同一份响应里出现两种时间精度只会给前端解析留坑。
     */
    private static OffsetDateTime toOffset(LocalDateTime localDateTime) {
        return localDateTime == null ? null
                : localDateTime.atZone(ZONE).toOffsetDateTime().truncatedTo(ChronoUnit.SECONDS);
    }

    /** 毫秒值取整为 Long；null 原样返回（「未测到」不能被 Math.round 变成 0）。 */
    private static Long round(Double value) {
        return value == null ? null : Math.round(value);
    }

    /**
     * 从单行 Map 里按<b>不区分大小写</b>的键取原始值。
     *
     * <p>为什么不能直接 {@code row.get("ready")}：列标签的大小写由 JDBC 驱动和
     * {@code map-underscore-to-camel-case} 共同决定，MyBatis 对 Map 结果集并不保证
     * 键名与 SQL 别名逐字相同。写死 {@code get("ready")} 是本机对、换个驱动就全是 0 ——
     * 而「全是 0」恰恰是那种不会报错、只会静静显示错的故障。
     */
    private static Object value(Map<String, Object> row, String key) {
        if (row == null) {
            return null;
        }
        for (Map.Entry<String, Object> entry : row.entrySet()) {
            if (entry.getKey().equalsIgnoreCase(key)) {
                return entry.getValue();
            }
        }
        return null;
    }

    /**
     * 取计数型列。{@code SUM()} 在空结果集上返回 NULL，按 0 处理 ——
     * 「这一格没有行」对计数而言就是 0，不是缺失。
     */
    private static long number(Map<String, Object> row, String key) {
        Object v = value(row, key);
        return v instanceof Number n ? n.longValue() : 0L;
    }

    /** 取可空计数列（区分「0 行」与「这一列没查」的场景基本不存在，保留给将来用）。 */
    private static Long longOrNull(Map<String, Object> row, String key) {
        Object v = value(row, key);
        return v instanceof Number n ? n.longValue() : null;
    }

    /** 取小数列（{@code AVG} 在 MySQL 里可能回 BigDecimal，必须按 Number 收）。 */
    private static Double dbl(Map<String, Object> row, String key) {
        Object v = value(row, key);
        return v instanceof Number n ? n.doubleValue() : null;
    }

    private static String str(Map<String, Object> row, String key) {
        Object v = value(row, key);
        return v == null ? null : String.valueOf(v);
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** 分桶结果 → {@code 桶标签 → 计数}。 */
    private static Map<String, Long> toCountMap(List<Map<String, Object>> rows, String valueKey) {
        Map<String, Long> map = new HashMap<>();
        if (rows == null) {
            return map;
        }
        for (Map<String, Object> row : rows) {
            String label = str(row, "bucket");
            if (label != null) {
                map.put(label, number(row, valueKey));
            }
        }
        return map;
    }

    /** 分桶均值 → {@code 桶标签 → 取整毫秒}；该桶没有均值时整个键不出现（上层读到 null）。 */
    private static Map<String, Long> toRoundedMap(List<Map<String, Object>> rows, String valueKey) {
        Map<String, Long> map = new HashMap<>();
        if (rows == null) {
            return map;
        }
        for (Map<String, Object> row : rows) {
            String label = str(row, "bucket");
            Long rounded = round(dbl(row, valueKey));
            if (label != null && rounded != null) {
                map.put(label, rounded);
            }
        }
        return map;
    }

    /** P95 结果 → {@code agent_id → p95 毫秒}。 */
    private static Map<Long, Long> toAgentP95Map(List<Map<String, Object>> rows) {
        Map<Long, Long> map = new HashMap<>();
        if (rows == null) {
            return map;
        }
        for (Map<String, Object> row : rows) {
            Long agentId = longOrNull(row, "agent_id");
            Long p95 = longOrNull(row, "p95_elapsed_ms");
            if (agentId != null && p95 != null) {
                map.put(agentId, p95);
            }
        }
        return map;
    }
}
