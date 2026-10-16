package com.campusflow.service.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campusflow.common.constant.FileConstant;
import com.campusflow.common.constant.RabbitMqConstant;
import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.exception.BusinessException;
import com.campusflow.common.response.Result;
import com.campusflow.service.aspect.MyLog;
import com.campusflow.service.entity.dto.AdminFileQueryDto;
import com.campusflow.service.entity.dto.AdminFileResolveDto;
import com.campusflow.service.entity.dto.FileScanMessage;
import com.campusflow.service.entity.po.Files;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.entity.vo.AdminFileRescanVo;
import com.campusflow.service.entity.vo.AdminFileResolveVo;
import com.campusflow.service.entity.vo.AdminFileVo;
import com.campusflow.service.mapper.FilesMapper;
import com.campusflow.service.service.IAdminFilesService;
import com.campusflow.service.support.AdminGuard;
import com.campusflow.service.support.MetricWindow;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 文件审核台实现（契约草案 {@code /admin/files*}）。
 *
 * <h3>派生态 state（库里没有这一列）</h3>
 * 与前端 {@code fileReviewStateOf}、后端 {@code FileScanRetryServiceImpl.HUMAN_REVIEW_CODES}
 * 三方同源，改口径必须一起改：
 * <pre>
 *   ready    = status='ready'
 *   rejected = status='rejected'
 *   manual   = status='scanning' 且 reason_code ∈ ('needs_review','content_truncated') —— 出路是人
 *   scanning = 其余（uploaded / 无结论码的 scanning —— 出路是补偿重投）
 * </pre>
 * ⚠️ 聚合/JSON 函数要拼 SQL 片段，这里用 {@link QueryWrapper} + 字符串列名，
 * 不用 {@code LambdaQueryWrapper}（它只收 lambda 列引用）。
 *
 * <h3>处置的幂等与冲突（对齐 /admin/reviews/resolve 既有口径）</h3>
 * <ul>
 *   <li>同 id 同动作重放 → 200 返回现状：ready 且 manual.action=approve 再 approve、
 *       rejected 再 reject，都是不产生变化的重复点击；</li>
 *   <li>同 id 异动作 → 409：rejected 改 approve、ready 改 reject —— 两个人在同时处理，
 *       静默覆盖会让先处置的记录消失；</li>
 *   <li>ready（链路放行，无 manual 记录）再处置 → 409：链路已放行，人工处置无意义，
 *       这也是契约里「前端据此区分链路放行与人工通过」那条约定的服务端落点。</li>
 * </ul>
 *
 * <h3>重扫的顺序</h3>
 * 先写库（状态回 scanning、结论作废）再投 MQ，包在同一个事务里：投递失败抛异常回滚，
 * 不留「看起来重扫了、其实没入队」的中间态。入队成功后旧结论由扫描链整体覆盖
 * （{@code markReady}/{@code markRejected}），补偿计数自然归零 —— 与既有约定一致。
 * 若消息在返回后丢失，记录停在 scanning，会被补偿 job 按 stale 捞起重投（无结论码不触发跳过）。
 *
 * @see com.campusflow.service.controller.AdminFilesController
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdminFilesServiceImpl implements IAdminFilesService {

    private static final int DEFAULT_PAGE = 1;
    private static final int DEFAULT_PAGE_SIZE = 8;
    private static final int MAX_PAGE_SIZE = 100;

    private static final ZoneId ZONE = MetricWindow.ZONE;

    /** 派生审核态取值白名单。 */
    private static final List<String> ALLOWED_STATE = List.of("manual", "scanning", "ready", "rejected", "all");

    /** 处置动作白名单。 */
    private static final List<String> ALLOWED_ACTION = List.of("approve", "reject");

    /**
     * 转人工原因码 —— 与 {@code FileScanRetryServiceImpl.HUMAN_REVIEW_CODES} 同源
     * （那边是 private，这里按契约再声明一份；改一处必改两处 + 前端 FILE_HUMAN_REVIEW_CODES）。
     */
    private static final Set<String> HUMAN_REVIEW_CODES = Set.of("needs_review", "content_truncated");

    /** {@code scan_result} 里人工处置记录的键。 */
    private static final String MANUAL_KEY = "manual";

    /** {@code scan_result} 里补偿计数的键（与 FileScanRetryServiceImpl.COMPENSATION_KEY 同源）。 */
    private static final String COMPENSATION_KEY = "compensation";

    /** {@code scan_result} 里程序判读用的失败码键。 */
    private static final String REASON_CODE_KEY = "reason_code";

    /** 前端「全部」筛选片的哨兵值 —— 不进查询串（同 /admin/reviews 的既有约定）。 */
    private static final String SENTINEL_ALL = "all";

    private final AdminGuard adminGuard;
    private final FilesMapper filesMapper;
    private final ObjectMapper objectMapper;
    private final RabbitTemplate rabbitTemplate;

    // ------------------------------------------------------------------ ① 列表

    @Override
    public Result<BaseQueryVo<AdminFileVo>> list(AdminFileQueryDto query) {
        adminGuard.requireAdmin();
        AdminFileQueryDto q = query == null ? new AdminFileQueryDto() : query;

        String state = trimToNull(q.getState());
        if (state == null) {
            state = "all";
        }
        requireEnum(state, ALLOWED_STATE, "审核态");

        String purpose = dropSentinel(q.getPurpose());

        int pageNo = q.getPage() == null || q.getPage() < 1 ? DEFAULT_PAGE : q.getPage();
        int pageSize = q.getPage_size() == null || q.getPage_size() < 1
                ? DEFAULT_PAGE_SIZE : Math.min(q.getPage_size(), MAX_PAGE_SIZE);

        // 逻辑删除的一律不进审核台（FileConstant.DELETED：所有列表查询都应排除它）
        QueryWrapper<Files> wrapper = new QueryWrapper<Files>()
                .isNull("deleted_at")
                .eq(purpose != null, "purpose", purpose)
                // 同秒上传要有稳定次序，否则翻页会重复/漏行
                .orderByDesc("uploaded_at")
                .orderByDesc("id");
        switch (state) {
            case "ready" -> wrapper.eq("status", FileConstant.READY);
            case "rejected" -> wrapper.eq("status", FileConstant.REJECTED);
            // manual：还在 scanning、但结论码是「等人」的那两类
            case "manual" -> wrapper.eq("status", FileConstant.SCANNING)
                    .apply("JSON_UNQUOTE(JSON_EXTRACT(scan_result,'$.reason_code')) IN ('needs_review','content_truncated')");
            // scanning：同样停在 scanning、但出路是补偿重投（无结论码或结论码不属于转人工）。
            // 🔴 reason_code 缺失时 JSON_EXTRACT 回 NULL，而 NULL NOT IN (...) 不为真 ——
            // 必须先把「没有结论码」的行显式 OR 进来，否则无结论码的 scanning 会被整批漏掉。
            case "scanning" -> wrapper.eq("status", FileConstant.SCANNING)
                    .apply("(scan_result IS NULL"
                            + " OR JSON_EXTRACT(scan_result,'$.reason_code') IS NULL"
                            + " OR JSON_UNQUOTE(JSON_EXTRACT(scan_result,'$.reason_code'))"
                            + " NOT IN ('needs_review','content_truncated'))");
            default -> {
                // all：不筛状态
            }
        }

        Page<Files> page = filesMapper.selectPage(new Page<>(pageNo, pageSize), wrapper);

        BaseQueryVo<AdminFileVo> vo = new BaseQueryVo<>();
        vo.setItems(toVos(page.getRecords()));
        vo.setTotal(page.getTotal());
        vo.setPage(pageNo);
        vo.setPage_size(pageSize);
        vo.setHas_more(page.hasNext());
        return new Result<BaseQueryVo<AdminFileVo>>().success(vo);
    }

    // ------------------------------------------------------------------ ② 人工处置

    @Override
    @Transactional(rollbackFor = Exception.class)
    @MyLog(value = "file", description = "人工处置文件审核")
    public Result<AdminFileResolveVo> resolve(Long id, AdminFileResolveDto body, String idempotencyKey) {
        Users admin = adminGuard.requireAdmin();
        if (id == null) {
            throw new BusinessException(400, "缺少文件 id");
        }
        String action = body == null ? null : trimToNull(body.getAction());
        if (action == null || !ALLOWED_ACTION.contains(action)) {
            throw new BusinessException(400, "不支持的处置动作：" + action + "（可选 approve / reject）");
        }

        Files file = loadFile(id);
        String status = file.getStatus();
        Map<String, Object> result = parseMap(file.getScanResult());
        Map<String, Object> manual = mapOf(result.get(MANUAL_KEY));

        // ready：链路已放行或已人工通过。只有「已人工 approve 的重放」原样返回现状，
        // 其余（链路放行后再处置、或想改判 reject）一律 409。
        if (FileConstant.READY.equals(status)) {
            boolean replay = "approve".equals(action)
                    && manual != null && action.equals(manual.get("action"));
            if (!replay) {
                throw new BusinessException(409, "该文件已通过审核（ready），无需处置，请刷新列表");
            }
            log.info("文件 {} 已人工通过，本次动作相同，按幂等重放返回现状（idempotencyKey={}）", id, idempotencyKey);
            return new Result<AdminFileResolveVo>().success(toResolveVo(file, action, str(manual.get("at"))));
        }

        // rejected：再 reject 是同动作重放（不产生变化），返回现状；改判 approve 是冲突。
        if (FileConstant.REJECTED.equals(status)) {
            if (!"reject".equals(action)) {
                throw new BusinessException(409, "该文件已被驳回（rejected），不能改为通过，请刷新列表后重试");
            }
            log.info("文件 {} 已是 rejected，本次动作相同，按幂等重放返回现状（idempotencyKey={}）", id, idempotencyKey);
            return new Result<AdminFileResolveVo>().success(toResolveVo(file, action, null));
        }

        // 只有 scanning（含转人工）可处置；uploaded/pending 说明链路还没跑完，不是人的事
        if (!FileConstant.SCANNING.equals(status)) {
            throw new BusinessException(409, "当前状态不允许人工处置：" + status
                    + "（仅扫描中/转人工的文件可处置）");
        }

        boolean approve = "approve".equals(action);
        String target = approve ? FileConstant.READY : FileConstant.REJECTED;
        OffsetDateTime now = OffsetDateTime.now(ZONE).truncatedTo(ChronoUnit.SECONDS);
        String comment = trimToNull(body.getComment());

        // 保留既有 mime/virus/moderation 等链路结论可追溯，只叠加人工结论与处置留痕
        result.put(REASON_CODE_KEY, approve ? "manual_approve" : "manual_reject");
        result.put("reason", comment != null ? comment : (approve ? "人工复核通过" : "人工复核驳回"));
        result.put("scanned_at", now.toString());
        Map<String, Object> manualRecord = new LinkedHashMap<>();
        manualRecord.put("action", action);
        manualRecord.put("by", displayNameOf(admin));
        manualRecord.put("at", now.toString());
        if (comment != null) {
            manualRecord.put("comment", comment);
        }
        result.put(MANUAL_KEY, manualRecord);

        writeStatusAndResult(id, target, result);

        log.info("文件 {} 已由管理员 {} 处置为 {}（动作 {}，comment={}，idempotencyKey={}）",
                id, admin.getId(), target, action, comment, idempotencyKey);
        AdminFileResolveVo vo = new AdminFileResolveVo();
        vo.setId(id);
        vo.setStatus(target);
        vo.setAction(action);
        vo.setResolved_at(now.toString());
        return new Result<AdminFileResolveVo>().success(vo);
    }

    // ------------------------------------------------------------------ ③ 重新扫描

    @Override
    @Transactional(rollbackFor = Exception.class)
    @MyLog(value = "file", description = "文件重新扫描入队")
    public Result<AdminFileRescanVo> rescan(Long id) {
        adminGuard.requireAdmin();
        if (id == null) {
            throw new BusinessException(400, "缺少文件 id");
        }
        Files file = loadFile(id);
        String status = file.getStatus();
        if (FileConstant.READY.equals(status)) {
            // 链路已放行，重扫没有意义
            throw new BusinessException(409, "该文件已通过审核，无需重新扫描");
        }
        if (!FileConstant.REJECTED.equals(status) && !FileConstant.SCANNING.equals(status)) {
            throw new BusinessException(409, "当前状态不允许重新扫描：" + status
                    + "（仅 rejected / scanning 可重扫）");
        }

        int attempts = compensationAttempts(parseMap(file.getScanResult())) + 1;
        OffsetDateTime now = OffsetDateTime.now(ZONE).truncatedTo(ChronoUnit.SECONDS);

        // 旧结论作废：scan_result 整体重置，只留补偿计数（对齐补偿 job 的既有约定）。
        // 扫完之后 markReady/markRejected 会用新结果整体覆盖，计数自然归零。
        Map<String, Object> compensation = new LinkedHashMap<>();
        compensation.put("attempts", attempts);
        compensation.put("last_attempt_at", now.toString());
        Map<String, Object> fresh = new LinkedHashMap<>();
        fresh.put(COMPENSATION_KEY, compensation);

        writeStatusAndResult(id, FileConstant.SCANNING, fresh);

        try {
            // 与上传后 / 补偿 job 的投递必须完全一致：三参数重载 + 同一 exchange/routingKey。
            // ⚠️ 别写成两参数 convertAndSend(routingKey, payload)：那是默认交换机，消息会被静默丢弃。
            rabbitTemplate.convertAndSend(
                    RabbitMqConstant.FILE_SCAN_EXCHANGE,
                    RabbitMqConstant.FILE_CAMPUSFLOW_ROUTING_KEY,
                    new FileScanMessage(id));
        } catch (Exception e) {
            // 抛出去让事务回滚：状态/计数保持原样，管理员重试即可；
            // 别留一个「状态已回 scanning、消息却没发出去」的中间态。
            log.error("重扫重新入队失败，事务回滚：fileId={}", id, e);
            throw new BusinessException(500, "重新加入扫描队列失败，请稍后重试");
        }

        log.info("文件 {} 已重新入扫描队列（重扫第 {} 次尝试，管理员确认操作）", id, attempts);
        AdminFileRescanVo vo = new AdminFileRescanVo();
        vo.setId(id);
        vo.setStatus(FileConstant.SCANNING);
        vo.setRequeued_at(now.toString());
        return new Result<AdminFileRescanVo>().success(vo);
    }

    // ------------------------------------------------------------------ 组装与工具

    private List<AdminFileVo> toVos(List<Files> records) {
        List<AdminFileVo> items = new java.util.ArrayList<>();
        if (records == null || records.isEmpty()) {
            return items;
        }
        for (Files record : records) {
            AdminFileVo vo = new AdminFileVo();
            vo.setId(record.getId());
            vo.setOwner_id(record.getOwnerId());
            vo.setPurpose(record.getPurpose());
            vo.setOriginal_name(record.getOriginalName());
            vo.setContent_type(record.getContentType());
            vo.setSize_bytes(record.getSizeBytes());
            vo.setSha256(record.getSha256());
            vo.setStatus(record.getStatus());
            vo.setScan_result(parseTree(record.getScanResult()));
            vo.setUploaded_at(toOffset(record.getUploadedAt()));
            vo.setUpdated_at(toOffset(record.getUpdatedAt()));
            items.add(vo);
        }
        return items;
    }

    /** 幂等重放/出参用：优先人工记录里的时间，其次 updated_at。 */
    private AdminFileResolveVo toResolveVo(Files file, String action, String resolvedAt) {
        AdminFileResolveVo vo = new AdminFileResolveVo();
        vo.setId(file.getId());
        vo.setStatus(file.getStatus());
        vo.setAction(action);
        if (resolvedAt != null) {
            vo.setResolved_at(resolvedAt);
        } else {
            OffsetDateTime updated = toOffset(file.getUpdatedAt());
            vo.setResolved_at(updated != null ? updated.toString()
                    : OffsetDateTime.now(ZONE).truncatedTo(ChronoUnit.SECONDS).toString());
        }
        return vo;
    }

    private Files loadFile(Long id) {
        Files file = id == null ? null : filesMapper.selectById(id);
        if (file == null || file.getDeletedAt() != null) {
            // 已逻辑删除的行对外不存在，也不给处置/重扫
            throw new BusinessException(404, "文件不存在或已删除");
        }
        return file;
    }

    /** 只 patch status + scan_result 两列；影响行数为 0 说明行已并发删除。 */
    private void writeStatusAndResult(long id, String status, Map<String, Object> result) {
        Files patch = new Files().setId(id).setStatus(status).setScanResult(toJson(result));
        int rows = filesMapper.updateById(patch);
        if (rows == 0) {
            throw new BusinessException(404, "文件不存在或已删除");
        }
    }

    private String toJson(Map<String, Object> result) {
        try {
            return objectMapper.writeValueAsString(result);
        } catch (JsonProcessingException e) {
            // scan_result 是 json 列，写入非法 JSON 会整行失败；序列化不了宁可报错也别静默丢结论
            throw new BusinessException(500, "处置记录序列化失败：" + e.getOriginalMessage());
        }
    }

    /** scan_result 原样解析（列表出参）；为空或非法 JSON 时回 null，不猜内容。 */
    private JsonNode parseTree(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            log.warn("scan_result 不是合法 JSON，列表里按 null 返回：{}", json, e);
            return null;
        }
    }

    private Map<String, Object> parseMap(String json) {
        if (json == null || json.isBlank()) {
            return new LinkedHashMap<>();
        }
        try {
            Map<String, Object> parsed = objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {
            });
            return parsed == null ? new LinkedHashMap<>() : parsed;
        } catch (Exception e) {
            log.warn("scan_result 不是合法 JSON，按空对象处理：{}", json, e);
            return new LinkedHashMap<>();
        }
    }

    private int compensationAttempts(Map<String, Object> result) {
        Map<String, Object> compensation = mapOf(result.get(COMPENSATION_KEY));
        if (compensation == null) {
            return 0;
        }
        Object attempts = compensation.get("attempts");
        return attempts instanceof Number n ? n.intValue() : 0;
    }

    /** 处置人署名：优先姓名，其次账号（scan_result.manual.by 是给页面看的字符串）。 */
    private static String displayNameOf(Users admin) {
        if (admin.getName() != null && !admin.getName().isBlank()) {
            return admin.getName();
        }
        return admin.getAccount();
    }

    private static Map<String, Object> mapOf(Object value) {
        if (!(value instanceof Map<?, ?> m)) {
            return null;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        m.forEach((k, v) -> result.put(String.valueOf(k), v));
        return result;
    }

    private static String str(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static OffsetDateTime toOffset(LocalDateTime localDateTime) {
        return localDateTime == null ? null
                : localDateTime.atZone(ZONE).toOffsetDateTime().truncatedTo(ChronoUnit.SECONDS);
    }

    /** 「全部」哨兵不进查询串 —— 字符串 all 会被当成精确匹配（必然 0 行）而不是「不限」。 */
    private static String dropSentinel(String value) {
        String trimmed = trimToNull(value);
        return trimmed == null || SENTINEL_ALL.equalsIgnoreCase(trimmed) ? null : trimmed;
    }

    /** 取值白名单校验；null 放行（= 不筛）。 */
    private static void requireEnum(String value, List<String> allowed, String label) {
        if (value != null && !allowed.contains(value)) {
            throw new BusinessException(400, "不支持的" + label + "：" + value
                    + "（可选 " + String.join(" / ", allowed) + "）");
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
