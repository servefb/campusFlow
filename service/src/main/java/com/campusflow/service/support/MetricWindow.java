package com.campusflow.service.support;

import com.campusflow.common.exception.BusinessException;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * 看板指标的时间窗口 —— {@code /admin/metrics/*} 四个接口<b>共用同一套口径</b>。
 *
 * <h3>为什么单独抽一个类型</h3>
 * {@code overview}（区间读数）、{@code trends}（逐桶采样）、{@code agents}（按时段聚合）、
 * {@code hot-questions}（同前）四个接口都吃 {@code range} 参数。如果每个实现各自解释
 * 「最近 7 天从哪一刻开始」，四个接口就会在切换档位时给出互相矛盾的窗口边界 ——
 * 而且不会有任何报错。
 *
 * <h3>边界口径</h3>
 * <ul>
 *   <li>{@code to} <b>恒为「此刻」</b>，不是「今天 23:59:59」。用右开区间
 *       {@code [from, to)} 查询，避免把 23:59:59.999 之后写入的行算进今天。</li>
 *   <li>{@code from} 是<b>自然日边界</b>：{@code 7d} = 含今天在内的 7 个自然日
 *       （今天 00:00 往前推 6 天），而不是「此刻往前推 168 小时」。两者在
 *       「按天分桶」的场景下会错开一格，越到下午越明显。</li>
 *   <li>{@code today} 的桶数只到<b>当前小时</b>为止。补满 24 个桶会在图上画出
 *       一条「未来几小时恒为 0」的尾巴，看起来像业务停摆。</li>
 * </ul>
 *
 * <h3>时区</h3>
 * 数据源 JDBC URL 写死了 {@code serverTimezone=Asia/Shanghai}，库里读出来的
 * {@code LocalDateTime} 就是东八区墙上时间，所以窗口边界也按东八区算。
 * ⚠️ 不要改成 {@code ZoneId.systemDefault()}：服务器 TZ 一变，窗口就整体漂移，
 * 而库里存的是墙上时间、不会跟着变。
 *
 * @param range    规范化后的档位：{@code today / 7d / 30d}
 * @param interval 采样粒度：{@code today} 为 {@code hour}，其余为 {@code day}
 * @param from     窗口起点（含）
 * @param to       窗口终点（不含）
 * @author JIA
 * @since 2026-09-23
 */
public record MetricWindow(String range, String interval, LocalDateTime from, LocalDateTime to) {

    public static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    /** 小时桶的展示格式，与 {@link #sqlBucketFormat()} 必须逐字一致（否则对不上桶）。 */
    private static final DateTimeFormatter HOUR_LABEL = DateTimeFormatter.ofPattern("HH:00");

    /** 天桶的展示格式，同上。 */
    private static final DateTimeFormatter DAY_LABEL = DateTimeFormatter.ofPattern("MM-dd");

    public static final String RANGE_TODAY = "today";
    public static final String RANGE_7D = "7d";
    public static final String RANGE_30D = "30d";

    private static final String SQL_HOUR_FORMAT = "%H:00";

    private static final String SQL_DAY_FORMAT = "%m-%d";

    /**
     * 解析 {@code range} 参数。
     *
     * <p>⚠️ 不认识的取值<b>直接报 400</b>，不静默退回 {@code today}。
     * 「传错了却返回一份看着正常的今日数据」是最难查的一类 bug：前端以为自己在看
     * 30 天数据，屏幕上显示的却是今天的数，而且没有任何迹象。
     * 同类处理见 {@code AuditLogsServiceImpl} 对 {@code result} 参数的做法。
     *
     * @param range 可为 null（按 {@code today} 处理 —— 缺省是合法用法，不是错误）
     */
    public static MetricWindow resolve(String range) {
        String key = range == null || range.isBlank() ? RANGE_TODAY : range.trim();
        LocalDateTime now = LocalDateTime.now(ZONE);
        LocalDate today = now.toLocalDate();
        return switch (key) {
            case RANGE_TODAY -> new MetricWindow(key, "hour", today.atStartOfDay(), now);
            case RANGE_7D -> new MetricWindow(key, "day", today.minusDays(6).atStartOfDay(), now);
            case RANGE_30D -> new MetricWindow(key, "day", today.minusDays(29).atStartOfDay(), now);
            default -> throw new BusinessException(400,
                    "不支持的时间窗口：" + key + "（可选 today / 7d / 30d）");
        };
    }

    /**
     * 与当前窗口<b>等长且紧邻</b>的上一个窗口，用于算环比。
     *
     * <p>「今日」的上一窗口因此是「昨日 00:00 → 昨日与此刻相同的时刻」，
     * 而不是昨日一整天。否则每天早上打开看板，对话量环比永远是负的 ——
     * 那是「半天比整天」，不是业务在下滑。同样的对齐逻辑见
     * {@code AuditLogsServiceImpl#getAuditSummary}。
     */
    public MetricWindow previous() {
        long minutes = ChronoUnit.MINUTES.between(from, to);
        return new MetricWindow(range, interval, from.minusMinutes(minutes), from);
    }

    /** 是否是小时粒度（决定桶标签格式与桶个数）。 */
    public boolean hourly() {
        return "hour".equals(interval);
    }

    /** 传给 {@code DATE_FORMAT} 的格式串，与 {@link #label} 的输出必须能对上。 */
    public String sqlBucketFormat() {
        return hourly() ? SQL_HOUR_FORMAT : SQL_DAY_FORMAT;
    }

    /** 某个桶起点的展示标签（{@code 08:00} / {@code 09-14}）。 */
    public String label(LocalDateTime bucketStart) {
        return (hourly() ? HOUR_LABEL : DAY_LABEL).format(bucketStart);
    }

    /**
     * 窗口内的全部桶起点，<b>含没有数据的空桶</b>。
     *
     * <p>空桶要保留：折线图的横轴是等距的，跳过空桶会让 09-11 和 09-14 挨在一起，
     * 看起来像连着三天都在提问。空桶的 {@code question_count} 是<b>真实的 0</b>
     * （那一小时确实没人问），不是缺失值 —— 缺失的是比率类指标，它们会另给 null。
     */
    public List<LocalDateTime> bucketStarts() {
        List<LocalDateTime> starts = new ArrayList<>();
        if (hourly()) {
            // 今天 00:00 起、到当前小时为止。到当前小时（含）而不是到 to：to 是「此刻」，
            // 当前小时内已经落库的部分属于这个桶。
            long hours = ChronoUnit.HOURS.between(from, to);
            for (long i = 0; i <= hours; i++) {
                starts.add(from.plusHours(i));
            }
        } else {
            long days = ChronoUnit.DAYS.between(from.toLocalDate(), to.toLocalDate());
            for (long i = 0; i <= days; i++) {
                starts.add(from.toLocalDate().plusDays(i).atStartOfDay());
            }
        }
        return starts;
    }

    /** 该桶的右边界（右开），用于「按桶查询」时的 {@code >= start AND < end}。 */
    public LocalDateTime bucketEnd(LocalDateTime bucketStart) {
        return hourly() ? bucketStart.plusHours(1) : bucketStart.plusDays(1);
    }

    /** 一个桶的起点 → SQL 分组键（与 {@link #sqlBucketFormat()} 生成的 {@code DATE_FORMAT} 输出同形）。 */
    public LocalDateTime bucketStartOf(LocalDateTime at) {
        return hourly() ? at.truncatedTo(ChronoUnit.HOURS) : at.toLocalDate().atStartOfDay();
    }
}
