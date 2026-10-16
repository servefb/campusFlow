package com.campusflow.service.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.exception.BusinessException;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.AutoLogDto;
import com.campusflow.service.entity.po.AuditLogs;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.entity.vo.AuditSummaryVo;
import com.campusflow.service.entity.vo.AutoLogVo;
import com.campusflow.service.mapper.AuditLogsMapper;
import com.campusflow.service.service.IAuditLogsService;
import com.campusflow.service.service.IUsersService;
import com.campusflow.service.support.AdminGuard;
import com.campusflow.service.support.AuditExport;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * 审计日志查询实现（契约文档第 15 章）。
 *
 * <h3>2026-09-23 这一轮改了什么</h3>
 * <ol>
 *   <li><b>新增 {@code keyword} / {@code result} 两个筛选</b>。此前前端发了被直接丢掉：
 *       搜索框与「执行结果状态」下拉在真实接口下等于摆设。</li>
 *   <li><b>空结果不再回 404</b>，改回 200 + 空列表。旧行为把「筛选没匹配」说成
 *       「接口不存在」，而且 {@code data: null} 会让没写容错的前端白屏
 *       （见本接口的既有踩坑记录）。</li>
 *   <li><b>操作人姓名查不到时不再整体失败</b>。原实现里「这一页的操作人一个都查不到」
 *       会返回 404，可是审计行本身是完整的（{@code operator_user_id} 指向已删除用户是常态）。</li>
 *   <li>补了分页缺省值：{@code page}/{@code page_size} 不传时给 1/20，
 *       避免 {@code new Page<>(null, null)} 抛 NPE 变成 500。</li>
 * </ol>
 *
 * <h3>⚠️ 权限</h3>
 * 审计日志是管理端数据，本轮补上了 {@link AdminGuard} 校验。此前这个接口只要带任意
 * 有效令牌（学生也行）就能读全站审计 —— 那等于把「谁在什么时候做了什么」公开给了所有登录用户。
 *
 * @author JIA
 * @since 2026-09-04
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AuditLogsServiceImpl extends ServiceImpl<AuditLogsMapper, AuditLogs> implements IAuditLogsService {

    private static final int DEFAULT_PAGE = 1;
    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 200;

    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    /** {@code audit_logs.result} 的 CHECK 枚举。 */
    private static final List<String> ALLOWED_RESULT = List.of("success", "failure");

    /** 「高危阻断」观察窗：近 7 天。见 {@link AuditSummaryVo} 的口径表。 */
    private static final int RISK_WINDOW_DAYS = 7;

    /** 关键词里的资源 id 判定：纯数字才当作 resource_id 去比，避免把「abc」强转成数字抛异常。 */
    private static final Pattern NUMERIC = Pattern.compile("\\d+");

    /**
     * 导出上限。
     *
     * <p>取 5 万是一个「够大且不会把内存打爆」的数：单行 CSV 约 96 字节，
     * 5 万行约 5 MB，加上实体对象也远在堆内安全区。
     * 超过时**截断并在响应头标注**，不静默 —— 理由见 {@link AuditExport}。
     */
    private static final int MAX_EXPORT_ROWS = 50_000;

    /** 导出文件里的时间格式（给人看，去掉 `T` 与毫秒）。 */
    private static final DateTimeFormatter EXPORT_TIME_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final IUsersService usersService;
    private final AdminGuard adminGuard;

    @Value("${campus-flow.audit.retention-days:90}")
    private int retentionDays;

    @Override
    public Result<BaseQueryVo> getAuditLogs(AutoLogDto autoLogDto) {
        adminGuard.requireAdmin();
        AutoLogDto query = autoLogDto == null ? new AutoLogDto() : autoLogDto;

        int pageNo = query.getPage() == null || query.getPage() < 1 ? DEFAULT_PAGE : query.getPage();
        int pageSize = query.getPage_size() == null || query.getPage_size() < 1
                ? DEFAULT_PAGE_SIZE : Math.min(query.getPage_size(), MAX_PAGE_SIZE);

        LambdaQueryWrapper<AuditLogs> wrapper = buildWrapper(query);

        Page<AuditLogs> page = page(new Page<>(pageNo, pageSize),
                wrapper.orderByDesc(AuditLogs::getCreatedAt).orderByDesc(AuditLogs::getId));

        List<AutoLogVo> items = toVos(page.getRecords());
        BaseQueryVo<AutoLogVo> vo = new BaseQueryVo<>();
        vo.setItems(items);
        vo.setTotal(page.getTotal());
        vo.setPage(pageNo);
        vo.setPage_size(pageSize);
        vo.setHas_more(page.hasNext());
        return new Result<BaseQueryVo>().success(vo);
    }

    @Override
    public Result<AuditSummaryVo> getAuditSummary() {
        adminGuard.requireAdmin();

        LocalDateTime todayStart = LocalDate.now(ZONE).atStartOfDay();
        LocalDateTime yesterdayStart = todayStart.minusDays(1);
        // 「昨日同期」= 昨日 00:00 到**与此刻相同的时刻**。不这么对齐就是拿
        // 「今天半天」去比「昨天一整天」，环比天然是负的 —— 每天早上看都像业务在暴跌。
        LocalDateTime yesterdaySameMoment = LocalDateTime.now(ZONE).minusDays(1);
        LocalDateTime riskWindowStart = LocalDateTime.now(ZONE).minusDays(RISK_WINDOW_DAYS);

        long todayEvents = count(new LambdaQueryWrapper<AuditLogs>().ge(AuditLogs::getCreatedAt, todayStart));
        long yesterdaySamePeriod = count(new LambdaQueryWrapper<AuditLogs>()
                .ge(AuditLogs::getCreatedAt, yesterdayStart)
                .le(AuditLogs::getCreatedAt, yesterdaySameMoment));

        long highRisk = count(new LambdaQueryWrapper<AuditLogs>()
                .eq(AuditLogs::getResult, "failure")
                .ge(AuditLogs::getCreatedAt, riskWindowStart));
        long windowTotal = count(new LambdaQueryWrapper<AuditLogs>()
                .ge(AuditLogs::getCreatedAt, riskWindowStart));
        long autoTask = count(new LambdaQueryWrapper<AuditLogs>()
                .isNull(AuditLogs::getOperatorUserId)
                .ge(AuditLogs::getCreatedAt, riskWindowStart));

        AuditSummaryVo vo = new AuditSummaryVo();
        vo.setToday_events(todayEvents);
        // 昨日同期为 0 → null（前端「—」）。不做 0 兜底：0 会被读成「与昨日持平」
        vo.setToday_events_delta(yesterdaySamePeriod == 0 ? null
                : (double) (todayEvents - yesterdaySamePeriod) / (double) yesterdaySamePeriod);
        vo.setHigh_risk_blocked(highRisk);
        vo.setAuto_task_rate(windowTotal == 0 ? null : (double) autoTask / (double) windowTotal);
        vo.setRetention_days(retentionDays);
        vo.setTotal(count(null));
        return new Result<AuditSummaryVo>().success(vo);
    }

    /**
     * {@code GET /admin/audit-logs/export} —— 导出 CSV（UTF-8 带 BOM）。
     *
     * <h3>三个实现决定</h3>
     * <ol>
     *   <li><b>同步返回文件流</b>，不做「导出任务 + 下载链接」。原型文案说的是后者，
     *       但那需要异步任务与通知中心（本工程没有产出方）。审计日志是小数据量低频操作，
     *       同步导出才是能立刻用上的那个。见 {@code AuditExport}。</li>
     *   <li><b>UTF-8 BOM 是必须的</b>：不带 BOM 的 UTF-8 CSV 在中文 Windows 的 Excel 里
     *       会按 GBK 解码，整份文件的中文全是乱码 —— 而「导出后用 Excel 打开」正是这个功能的用法。</li>
     *   <li><b>限制行数并显式标注截断</b>：见 {@code AuditExport} 的类注释，
     *       静默截断会让合规归档少掉一段且毫无痕迹。</li>
     * </ol>
     *
     * <p>筛选条件与列表共用 {@link #buildWrapper}，「列表筛出 3 条、导出却是全部」
     * 这类偏差从结构上不可能发生。
     */
    @Override
    public AuditExport exportAuditLogs(AutoLogDto autoLogDto) {
        adminGuard.requireAdmin();
        AutoLogDto query = autoLogDto == null ? new AutoLogDto() : autoLogDto;

        /*
         * 多取一行来判断「是否还有更多」：直接拿 size() > MAX 判断截断，
         * 不会把「恰好等于上限」误报成截断。
         */
        List<AuditLogs> records = list(buildWrapper(query)
                .orderByDesc(AuditLogs::getCreatedAt)
                .orderByDesc(AuditLogs::getId)
                .last("LIMIT " + (MAX_EXPORT_ROWS + 1)));
        boolean truncated = records.size() > MAX_EXPORT_ROWS;
        if (truncated) {
            records = records.subList(0, MAX_EXPORT_ROWS);
        }

        StringBuilder csv = new StringBuilder(records.size() * 96 + 64);
        csv.append('\uFEFF'); // UTF-8 BOM，见方法注释第 2 点
        csv.append("时间,操作人ID,操作人姓名,动作,资源类型,资源ID,执行结果,IP地址\r\n");
        for (AutoLogVo vo : toVos(records)) {
            csv.append(csvCell(toShanghaiText(vo.getCreated_at()))).append(',')
                    .append(csvCell(vo.getOperator_id())).append(',')
                    .append(csvCell(vo.getOperator_name())).append(',')
                    .append(csvCell(vo.getAction())).append(',')
                    .append(csvCell(vo.getResource_type())).append(',')
                    .append(csvCell(vo.getResource_id())).append(',')
                    .append(csvCell(vo.getResult())).append(',')
                    .append(csvCell(vo.getIp_address())).append("\r\n");
        }
        return new AuditExport(csv.toString().getBytes(StandardCharsets.UTF_8), records.size(),
                MAX_EXPORT_ROWS, truncated);
    }

    // ------------------------------------------------------------------ 内部工具

    /**
     * 列表与导出共用的筛选条件构造。
     *
     * <p>存在的唯一理由是「保证两侧筛选一致」。各写一份的结局必然是
     * 「页面上筛选出 3 条、导出却是全部」——而且没人会去比对。
     *
     * <p>⚠️ 不含排序与分页：调用方各自追加（列表要分页、导出要 LIMIT 与倒序）。
     * 也因此这里<b>不能</b>用 {@code last()}，否则调用方再拼一次会得到两段冲突的尾部 SQL。
     */
    private LambdaQueryWrapper<AuditLogs> buildWrapper(AutoLogDto query) {
        String result = trimToNull(query.getResult());
        if (result != null && !ALLOWED_RESULT.contains(result)) {
            // 不认识的取值直接报错，别静默按「不限」处理 ——
            // 那会让「筛了没反应」变成一个看不出来的 bug
            throw new BusinessException(400, "不支持的执行结果：" + result + "（可选 success / failure）");
        }

        LambdaQueryWrapper<AuditLogs> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(query.getOperator_id() != null, AuditLogs::getOperatorUserId, query.getOperator_id())
                .eq(query.getAction() != null, AuditLogs::getAction, query.getAction())
                .eq(query.getResource_type() != null, AuditLogs::getResourceType, query.getResource_type())
                .eq(result != null, AuditLogs::getResult, result)
                .between(query.getFrom() != null && query.getTo() != null,
                        AuditLogs::getCreatedAt, query.getFrom(), query.getTo());
        applyKeyword(wrapper, trimToNull(query.getKeyword()));
        return wrapper;
    }

    /**
     * 审计时间戳的可读化：{@code 2026-09-23T17:24:18.707} → {@code 2026-09-23 17:24:18}。
     *
     * <p>只影响导出文件：列表接口回的是原样的 ISO 串（前端自己格式化），
     * 导出是给人用 Excel 看的，`T` 与毫秒都是噪音。解析失败时原样返回，
     * 不因为一个格式怪异的字符串就让整份导出失败。
     */
    private static String toShanghaiText(String isoDateTime) {
        if (isoDateTime == null) {
            return null;
        }
        try {
            return LocalDateTime.parse(isoDateTime).format(EXPORT_TIME_FORMAT);
        } catch (RuntimeException e) {
            return isoDateTime;
        }
    }

    /**
     * CSV 单元格转义（RFC 4180）。
     *
     * <p>必须处理逗号、双引号与换行 —— 审计数据里的动作与资源类型虽然规整，
     * 但操作人姓名一旦含逗号（如「张三, 李四」）就会把整行列数顶偏，
     * Excel 里表现为「后面所有列都错位」。用双引号包裹并把内部引号翻倍是标准解法。
     */
    private static String csvCell(Object value) {
        if (value == null) {
            return "";
        }
        String text = String.valueOf(value);
        if (text.indexOf(',') >= 0 || text.indexOf('"') >= 0
                || text.indexOf('\n') >= 0 || text.indexOf('\r') >= 0) {
            return '"' + text.replace("\"", "\"\"") + '"';
        }
        return text;
    }

    /**
     * 关键词筛选：命中「操作人姓名 / 账号、动作、资源类型、IP、资源 id」任一。
     *
     * <p>操作人姓名不在 {@code audit_logs} 表里，所以先按 users 表反查 id 集合再
     * {@code IN} —— 注意 <b>空集合的 IN 会渲染成 {@code IN ()} 变成 SQL 语法错误</b>，
     * 所以用「命中用户就加条件、没命中就只按表内字段查」的写法，而不是无条件 IN。
     */
    private void applyKeyword(LambdaQueryWrapper<AuditLogs> wrapper, String keyword) {
        if (keyword == null) {
            return;
        }
        List<Long> matchedUserIds = usersService.lambdaQuery()
                .and(w -> w.like(Users::getName, keyword).or().like(Users::getAccount, keyword))
                .list().stream().map(Users::getId).filter(Objects::nonNull).toList();

        Long numericId = NUMERIC.matcher(keyword).matches() ? parseLong(keyword) : null;
        wrapper.and(w -> {
            w.like(AuditLogs::getAction, keyword)
                    .or().like(AuditLogs::getResourceType, keyword)
                    .or().like(AuditLogs::getIpAddress, keyword);
            if (numericId != null) {
                w.or().eq(AuditLogs::getResourceId, numericId);
            }
            if (!matchedUserIds.isEmpty()) {
                w.or().in(AuditLogs::getOperatorUserId, matchedUserIds);
            }
        });
    }

    /**
     * 审计行 → 出参。
     *
     * <p>⚠️ 与 {@code AutoLogVo} 的既有约定一致：这里<b>只给原始枚举</b>
     * （{@code resource_type='user'}、{@code action='user.login'}），中文标签由管理端的
     * {@code normalizeAuditLog()} 负责 —— 后端再给一份中文名就会有两套译名各说各话。
     *
     * <p>操作人姓名为空时保持 {@code null}，不再整体返回 404：审计行是完整的，
     * 只是操作人可能已被删除（{@code operator_user_id} 留痕但用户注销），
     * 这种情况恰恰是审计最该保留的记录。
     */
    private List<AutoLogVo> toVos(List<AuditLogs> records) {
        List<AutoLogVo> items = new ArrayList<>();
        if (records == null || records.isEmpty()) {
            return items;
        }
        List<Long> operatorIds = records.stream().map(AuditLogs::getOperatorUserId)
                .filter(Objects::nonNull).distinct().toList();
        Map<Long, String> nameById = new HashMap<>();
        if (!operatorIds.isEmpty()) {
            for (Users user : usersService.lambdaQuery().in(Users::getId, operatorIds).list()) {
                nameById.put(user.getId(), user.getName());
            }
        }
        for (AuditLogs record : records) {
            AutoLogVo vo = new AutoLogVo();
            vo.setId(record.getId());
            vo.setOperator_id(record.getOperatorUserId());
            vo.setOperator_name(nameById.get(record.getOperatorUserId()));
            vo.setAction(record.getAction());
            vo.setResource_type(record.getResourceType());
            vo.setResource_id(record.getResourceId());
            vo.setResult(record.getResult());
            vo.setIp_address(record.getIpAddress());
            vo.setCreated_at(record.getCreatedAt() == null ? null : record.getCreatedAt().toString());
            items.add(vo);
        }
        return items;
    }

    private static Long parseLong(String value) {
        try {
            return Long.valueOf(value);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
