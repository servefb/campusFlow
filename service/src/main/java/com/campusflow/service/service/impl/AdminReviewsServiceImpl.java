package com.campusflow.service.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.exception.BusinessException;
import com.campusflow.common.response.Result;
import com.campusflow.service.aspect.MyLog;
import com.campusflow.service.entity.dto.ReviewQueryDto;
import com.campusflow.service.entity.dto.ReviewResolveDto;
import com.campusflow.service.entity.po.Agents;
import com.campusflow.service.entity.po.ContentReviews;
import com.campusflow.service.entity.po.Conversations;
import com.campusflow.service.entity.po.MessageCitations;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.entity.vo.ReviewItemVo;
import com.campusflow.service.entity.vo.ReviewResolveVo;
import com.campusflow.service.mapper.AgentsMapper;
import com.campusflow.service.mapper.ContentReviewsMapper;
import com.campusflow.service.mapper.ConversationsMapper;
import com.campusflow.service.mapper.MessageCitationsMapper;
import com.campusflow.service.mapper.UsersMapper;
import com.campusflow.service.service.IAdminReviewsService;
import com.campusflow.service.support.AdminGuard;
import com.campusflow.service.support.MetricWindow;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 人工复核队列实现（契约文档第 14 章 {@code /admin/reviews*}）。
 *
 * <h3>三个容易踩的点，都在这里处理掉了</h3>
 * <ol>
 *   <li><b>空队列必须回 200 + 空列表，不能回 404</b>。这个坑审计日志接口踩过：
 *       老实现「查不到就 404 + data:null」，前端把 <i>筛选没匹配</i> 读成 <i>接口不存在</i>，
 *       而 {@code data:null} 还会让没写容错的地方直接白屏。当前 {@code content_reviews}
 *       表就是空的，第一个访问的人立刻会撞上。</li>
 *   <li><b>提问人信息要跨三张表</b>：{@code content_reviews.conversation_id →
 *       conversations.user_id → users}。全部<b>批量</b>取，不在循环里查
 *       （一页 8 条就是 24 次单查）。任何一环缺失都只让对应字段为 null，
 *       不让整页失败 —— 会话被删是常态，而工单本身仍然完整。</li>
 *   <li><b>处置的幂等</b>：见 {@link #resolve}。</li>
 * </ol>
 *
 * @see com.campusflow.service.controller.AdminReviewsController
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdminReviewsServiceImpl extends ServiceImpl<ContentReviewsMapper, ContentReviews>
        implements IAdminReviewsService {

    private static final int DEFAULT_PAGE = 1;
    private static final int DEFAULT_PAGE_SIZE = 8;
    private static final int MAX_PAGE_SIZE = 100;

    private static final ZoneId ZONE = MetricWindow.ZONE;

    /** {@code content_reviews.status} 的库枚举。 */
    private static final List<String> ALLOWED_STATUS = List.of("pending", "resolved", "rejected");

    /** {@code content_reviews.risk}。注意库列是 {@code varchar(16)}、没有 CHECK，所以这里的白名单是唯一约束。 */
    private static final List<String> ALLOWED_RISK = List.of("high", "medium", "low");

    /**
     * {@code content_reviews.reason} 的取值。
     *
     * <p>⚠️ 与 {@code db/2026-09-23-admin-console.sql} 里那一行注释<b>逐字对应</b>：
     * 加值要两边一起加，否则新原因会被自己的入参校验挡在门外（400），
     * 而不是「未知值原样显示」—— 这是本项目对枚举的一贯取舍：宁可报错也别静默。
     */
    private static final List<String> ALLOWED_REASON = List.of(
            "low_confidence", "policy_conflict", "hallucination",
            "sensitive", "stale_citation", "security", "privacy");

    /** 前端「全部」筛选片发出来的哨兵值 —— 不能进查询串，见《接口对接说明》的既有约定。 */
    private static final String SENTINEL_ALL = "all";

    /** 处置动作。 */
    private static final List<String> ALLOWED_ACTION = List.of("approve", "correct", "reject");

    private static final Map<String, String> REASON_LABEL = Map.of(
            "low_confidence", "置信度低",
            "policy_conflict", "政策口径冲突",
            "hallucination", "幻觉输出",
            "sensitive", "敏感内容",
            "stale_citation", "时效引用失效",
            "security", "安全渗透",
            "privacy", "隐私防护");

    private final AdminGuard adminGuard;
    private final AgentsMapper agentsMapper;
    private final ConversationsMapper conversationsMapper;
    private final UsersMapper usersMapper;
    private final MessageCitationsMapper messageCitationsMapper;
    private final ObjectMapper objectMapper;

    @Override
    public Result<BaseQueryVo<ReviewItemVo>> getReviews(ReviewQueryDto query) {
        adminGuard.requireAdmin();
        ReviewQueryDto q = query == null ? new ReviewQueryDto() : query;

        // 缺省看「未处置」队列 —— 管理端默认也是 status=pending，这里对齐，
        // 免得直接调接口（不带参数）拿到一堆已完结工单，看着像队列没清空
        String status = trimToNull(q.getStatus());
        if (status == null) {
            status = "pending";
        }
        requireEnum(status, ALLOWED_STATUS, "工单状态");

        String risk = dropSentinel(q.getRisk());
        requireEnum(risk, ALLOWED_RISK, "风险等级");

        String reason = dropSentinel(q.getReason());
        requireEnum(reason, ALLOWED_REASON, "开单原因");

        int pageNo = q.getPage() == null || q.getPage() < 1 ? DEFAULT_PAGE : q.getPage();
        int pageSize = q.getPage_size() == null || q.getPage_size() < 1
                ? DEFAULT_PAGE_SIZE : Math.min(q.getPage_size(), MAX_PAGE_SIZE);

        LambdaQueryWrapper<ContentReviews> wrapper = new LambdaQueryWrapper<ContentReviews>()
                .eq(ContentReviews::getStatus, status)
                .eq(risk != null, ContentReviews::getRisk, risk)
                .eq(reason != null, ContentReviews::getReason, reason)
                // 同秒创建的工单要有稳定次序，否则翻页会重复/漏行
                .orderByDesc(ContentReviews::getCreatedAt)
                .orderByDesc(ContentReviews::getId);

        Page<ContentReviews> page = page(new Page<>(pageNo, pageSize), wrapper);

        BaseQueryVo<ReviewItemVo> vo = new BaseQueryVo<>();
        vo.setItems(toVos(page.getRecords(), false));
        vo.setTotal(page.getTotal());
        vo.setPage(pageNo);
        vo.setPage_size(pageSize);
        vo.setHas_more(page.hasNext());
        return new Result<BaseQueryVo<ReviewItemVo>>().success(vo);
    }

    @Override
    public Result<ReviewItemVo> getReviewDetail(Long id) {
        adminGuard.requireAdmin();
        ContentReviews record = id == null ? null : getById(id);
        if (record == null) {
            throw new BusinessException(404, "复核工单不存在");
        }
        List<ReviewItemVo> items = toVos(List.of(record), true);
        return new Result<ReviewItemVo>().success(items.get(0));
    }

    /**
     * 处置一张工单。
     *
     * <h3>幂等怎么做</h3>
     * 管理端在请求头带 {@code Idempotency-Key}，但本实现<b>不</b>落 {@code idempotency_records}：
     * 这张表的业务只可能是「再点一次通过」，而「再点一次」在<b>行状态</b>上已经能判出来：
     * <ul>
     *   <li>工单已是终态、且动作与这次相同 → 直接返回现有终态（200，重放友好）；</li>
     *   <li>工单已是终态、动作<b>不同</b> → 409。这条不是「重试」，是两个人同时在处理，
     *       静默覆盖会让先处置的那条记录消失，而审计里看不出谁被覆盖了。</li>
     * </ul>
     * 需要更细的重放语义（例如原样回放响应体）时再引 {@code idempotency_records}，
     * 届时把 key 一并落库即可 —— 接口形态不用变。
     *
     * @param idempotencyKey 请求头值，仅记进日志便于排查
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    @MyLog(value = "review", description = "处置人工复核工单")
    public Result<ReviewResolveVo> resolve(Long id, ReviewResolveDto body, String idempotencyKey) {
        Users admin = adminGuard.requireAdmin();
        if (id == null) {
            throw new BusinessException(400, "缺少工单 id");
        }
        ContentReviews record = getById(id);
        if (record == null) {
            throw new BusinessException(404, "复核工单不存在");
        }

        String action = body == null ? null : trimToNull(body.getAction());
        if (action == null || !ALLOWED_ACTION.contains(action)) {
            throw new BusinessException(400, "不支持的处置动作：" + action + "（可选 approve / correct / reject）");
        }
        String correctedAnswer = body == null ? null : trimToNull(body.getCorrected_answer());
        if ("correct".equals(action) && correctedAnswer == null) {
            // 订正却没有正文 = 一次「看起来成功」的空操作，工单会变成已处置但没有新答案
            throw new BusinessException(400, "选择「订正」时必须提供 corrected_answer");
        }

        if (!"pending".equals(record.getStatus())) {
            if (action.equals(record.getAction())) {
                log.info("复核工单 {} 已由他人处置为 {}，本次请求动作相同，按幂等重放返回现状（idempotencyKey={}）",
                        id, record.getStatus(), idempotencyKey);
                return new Result<ReviewResolveVo>().success(toResolveVo(record));
            }
            throw new BusinessException(409, "该工单已被处置（当前状态：" + record.getStatus()
                    + "，动作：" + record.getAction() + "），请刷新队列后重试");
        }

        record.setStatus("reject".equals(action) ? "rejected" : "resolved");
        record.setAction(action);
        record.setCorrectedAnswer(correctedAnswer);
        record.setComment(body.getComment());
        record.setCitationIds(writeCitationIds(body.getCitation_ids()));
        record.setReviewedBy(admin.getId());
        record.setReviewedAt(LocalDateTime.now(ZONE));
        // updateById 会带上 updated_at 的 ON UPDATE，不需要手动设
        updateById(record);

        log.info("复核工单 {} 已由用户 {} 处置为 {}（动作 {}，idempotencyKey={}）",
                id, admin.getId(), record.getStatus(), action, idempotencyKey);
        return new Result<ReviewResolveVo>().success(toResolveVo(record));
    }

    // ------------------------------------------------------------------ 组装

    /**
     * 工单行 → 出参。
     *
     * @param withCitations 详情接口才需要引用列表。列表页不填：那会变成「每行一次查询」的
     *                      N+1，而页面根本没渲染它
     */
    private List<ReviewItemVo> toVos(List<ContentReviews> records, boolean withCitations) {
        List<ReviewItemVo> items = new ArrayList<>();
        if (records == null || records.isEmpty()) {
            return items;
        }

        // 1) Agent 中文名：agent_key → name
        List<String> agentKeys = records.stream().map(ContentReviews::getAgentKey)
                .filter(Objects::nonNull).distinct().toList();
        Map<String, String> agentNameByKey = new HashMap<>();
        if (!agentKeys.isEmpty()) {
            for (Agents agent : agentsMapper.selectList(
                    new LambdaQueryWrapper<Agents>().in(Agents::getAgentKey, agentKeys))) {
                agentNameByKey.put(agent.getAgentKey(), agent.getName());
            }
        }

        // 2) 提问人：conversation_id → user_id → users
        List<String> conversationIds = records.stream().map(ContentReviews::getConversationId)
                .filter(Objects::nonNull).map(String::valueOf).distinct().toList();
        Map<String, Users> askerByConversation = new HashMap<>();
        if (!conversationIds.isEmpty()) {
            List<Conversations> conversations = conversationsMapper.selectList(
                    new LambdaQueryWrapper<Conversations>().in(Conversations::getId, conversationIds));
            List<Long> userIds = conversations.stream().map(Conversations::getUserId)
                    .filter(Objects::nonNull).map(AdminReviewsServiceImpl::parseLong)
                    .filter(Objects::nonNull).distinct().toList();
            Map<Long, Users> userById = new HashMap<>();
            if (!userIds.isEmpty()) {
                for (Users user : usersMapper.selectBatchIds(userIds)) {
                    userById.put(user.getId(), user);
                }
            }
            for (Conversations conversation : conversations) {
                Users asker = userById.get(parseLong(conversation.getUserId()));
                if (asker != null) {
                    // 会话 id 在 PO 里是 String（历史遗留），用它做键
                    askerByConversation.put(conversation.getId(), asker);
                }
            }
        }

        for (ContentReviews record : records) {
            ReviewItemVo vo = new ReviewItemVo();
            vo.setId(record.getId());
            vo.setMessage_id(record.getMessageId());
            vo.setConversation_id(record.getConversationId());
            vo.setReason(record.getReason());
            // 闭合枚举的展示译名，见 ReviewItemVo 的注释
            vo.setReason_label(REASON_LABEL.getOrDefault(record.getReason(), record.getReason()));
            vo.setRisk(record.getRisk());
            vo.setConfidence(record.getConfidence() == null ? null : record.getConfidence().doubleValue());
            vo.setQuestion(record.getQuestion());
            vo.setAnswer(record.getAnswer());
            vo.setStatus(record.getStatus());
            vo.setAgent_name(record.getAgentKey() == null ? null : agentNameByKey.get(record.getAgentKey()));
            vo.setModel(record.getModel());
            vo.setCreated_at(toOffset(record.getCreatedAt()));

            Users asker = record.getConversationId() == null
                    ? null : askerByConversation.get(String.valueOf(record.getConversationId()));
            // 取不到就 null，前端显示「—」；不拿「未知用户」这类兜底文案糊上去
            vo.setAsker_account(asker == null ? null : asker.getAccount());
            vo.setAsker_department(asker == null ? null : asker.getDepartmentName());

            if (withCitations) {
                vo.setCitations(loadCitations(record.getMessageId()));
            }
            items.add(vo);
        }
        return items;
    }

    /**
     * 该回答挂了哪些引用。字段名随契约（{@code document_id / section_id / similarity / excerpt}）。
     */
    private List<Map<String, Object>> loadCitations(Long messageId) {
        List<Map<String, Object>> citations = new ArrayList<>();
        if (messageId == null) {
            return citations;
        }
        List<MessageCitations> rows = messageCitationsMapper.selectList(
                new LambdaQueryWrapper<MessageCitations>()
                        .eq(MessageCitations::getMessageId, String.valueOf(messageId))
                        .orderByAsc(MessageCitations::getCitationOrder));
        for (MessageCitations row : rows) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("document_id", parseLong(row.getDocumentId()));
            item.put("section_id", parseLong(row.getSectionId()));
            item.put("similarity", row.getSimilarity());
            item.put("excerpt", row.getExcerpt());
            citations.add(item);
        }
        return citations;
    }

    private ReviewResolveVo toResolveVo(ContentReviews record) {
        ReviewResolveVo vo = new ReviewResolveVo();
        vo.setId(record.getId());
        vo.setStatus(record.getStatus());
        vo.setAction(record.getAction());
        vo.setResolved_at(toOffset(record.getReviewedAt()));
        return vo;
    }

    // ------------------------------------------------------------------ 工具

    /** 「全部」哨兵不进查询串 —— 字符串 all 会被当成精确匹配（必然 0 行）而不是「不限」。 */
    private static String dropSentinel(String value) {
        String trimmed = trimToNull(value);
        return trimmed == null || SENTINEL_ALL.equalsIgnoreCase(trimmed) ? null : trimmed;
    }

    /** 取值白名单校验；null 放行（= 不筛）。 */
    private static void requireEnum(String value, List<String> allowed, String label) {
        if (value != null && !allowed.contains(value)) {
            throw new BusinessException(400, "不支持的" + label + "：" + value + "（可选 " + String.join(" / ", allowed) + "）");
        }
    }

    /**
     * 引用 id 列表 → JSON 数组文本。
     *
     * <p>列表为空时存 null 而不是 {@code []}：两者语义相同，但 null 让
     * 「没订正过」和「订正了但不保留任何引用」在库里还能区分出来。
     */
    private String writeCitationIds(List<String> citationIds) {
        if (citationIds == null || citationIds.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(citationIds);
        } catch (JsonProcessingException e) {
            // 序列化字符串列表失败只可能是编码问题，属于环境故障，直接冒泡比存半截 JSON 好
            throw new BusinessException(500, "引用列表序列化失败：" + e.getOriginalMessage());
        }
    }

    private static OffsetDateTime toOffset(LocalDateTime localDateTime) {
        return localDateTime == null ? null
                : localDateTime.atZone(ZONE).toOffsetDateTime().truncatedTo(ChronoUnit.SECONDS);
    }

    private static Long parseLong(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Long.valueOf(value.trim());
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
