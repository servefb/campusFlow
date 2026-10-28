package com.campusflow.service.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.exception.BusinessException;
import com.campusflow.common.exception.NotFoundException;
import com.campusflow.common.response.Result;
import com.campusflow.service.aspect.MyLog;
import com.campusflow.service.entity.dto.NewsSourceQueryDto;
import com.campusflow.service.entity.dto.NewsSourceUpdateDto;
import com.campusflow.service.entity.po.NewsSources;
import com.campusflow.service.entity.vo.NewsSourceVo;
import com.campusflow.service.mapper.NewsSourcesMapper;
import com.campusflow.service.service.INewsSourcesService;
import com.campusflow.service.support.AdminGuard;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 新闻源治理实现。
 *
 * <h3>接口命名 ↔ 库列名的映射（唯一的一处，改就改这里）</h3>
 * <pre>
 *   status                 ↔ is_enabled            （active=1 / paused=0）
 *   base_url               ↔ source_url
 *   last_synced_at         ↔ last_sync_at
 *   sync_interval_minutes  ↔ sync_rule.interval_minutes
 *   category               ↔ sync_rule.category
 *   selector.list          ↔ sync_rule.selector
 *   selector.title         ↔ sync_rule.titleField
 *   selector.published_at  ↔ sync_rule.dateField
 * </pre>
 * ⚠️ {@code sync_rule} 里的选择器键名（{@code selector / titleField / dateField}）是
 * <b>库里既有数据的实际形状</b>（如源 102：{@code {"selector": ".notice-list li",
 * "dateField": "span.date", "titleField": "a.text"}}），不是我们新造的。改写时必须
 * **保留其它未识别的键**（如 rss 源的 {@code feedType}、api 源的 {@code endpoint}），
 * 否则编辑一次同步周期就把抓取配置抹掉了 —— 那种「改了个开关，抓取坏了」最难查。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NewsSourcesServiceImpl extends ServiceImpl<NewsSourcesMapper, NewsSources> implements INewsSourcesService {

    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    private static final int DEFAULT_PAGE = 1;
    private static final int DEFAULT_PAGE_SIZE = 10;
    private static final int MAX_PAGE_SIZE = 200;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AdminGuard adminGuard;

    @Override
    public Result<BaseQueryVo<NewsSourceVo>> listSources(NewsSourceQueryDto query) {
        adminGuard.requireAdmin();
        NewsSourceQueryDto q = query == null ? new NewsSourceQueryDto() : query;

        int pageNo = q.getPage() == null || q.getPage() < 1 ? DEFAULT_PAGE : q.getPage();
        int pageSize = q.getPage_size() == null || q.getPage_size() < 1
                ? DEFAULT_PAGE_SIZE : Math.min(q.getPage_size(), MAX_PAGE_SIZE);

        LambdaQueryWrapper<NewsSources> wrapper = new LambdaQueryWrapper<>();
        String keyword = trimToNull(q.getKeyword());
        if (keyword != null) {
            wrapper.and(w -> w.like(NewsSources::getName, keyword).or().like(NewsSources::getSourceUrl, keyword));
        }
        if (hasFilter(q.getStatus())) {
            // 契约的 active/paused 与库里的布尔位互转；未知取值直接 400，
            // 不静默当成「不限」—— 那会让筛选看起来生效了、其实返回全量。
            Boolean enabled = toEnabled(q.getStatus());
            if (enabled == null) {
                throw new BusinessException(400, "不支持的新闻源状态：" + q.getStatus()
                        + "（可选 active / paused）");
            }
            wrapper.eq(NewsSources::getIsEnabled, enabled);
        }
        wrapper.orderByDesc(NewsSources::getUpdatedAt).orderByAsc(NewsSources::getId);

        Page<NewsSources> page = page(new Page<>(pageNo, pageSize), wrapper);
        BaseQueryVo<NewsSourceVo> vo = new BaseQueryVo<>();
        List<NewsSourceVo> items = new ArrayList<>();
        for (NewsSources source : page.getRecords()) {
            items.add(toVo(source));
        }
        vo.setItems(items);
        vo.setTotal(page.getTotal());
        vo.setPage(pageNo);
        vo.setPage_size(pageSize);
        vo.setHas_more(page.hasNext());
        return new Result<BaseQueryVo<NewsSourceVo>>().success(vo);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    @MyLog(value = "news_source", description = "编辑新闻源抓取规则")
    public Result<Map<String, Object>> updateSource(String id, NewsSourceUpdateDto payload) {
        adminGuard.requireAdmin();
        NewsSources source = requireSource(id);
        if (payload == null) {
            throw new BusinessException(400, "请求体为空");
        }

        boolean changed = false;

        if (payload.getStatus() != null) {
            Boolean enabled = toEnabled(payload.getStatus());
            if (enabled == null) {
                throw new BusinessException(400, "不支持的新闻源状态：" + payload.getStatus()
                        + "（可选 active / paused）");
            }
            source.setIsEnabled(enabled);
            changed = true;
        }

        // sync_rule 是 JSON：读取 → 只改指定键 → 写回，未识别的键原样保留（见类注释）
        ObjectNode rule = readRule(source.getSyncRule());
        boolean ruleChanged = false;

        if (payload.getSync_interval_minutes() != null) {
            int minutes = payload.getSync_interval_minutes();
            if (minutes < 5 || minutes > 10080) {
                // 下限 5 分钟：抓取是外部站点的负载，配成 1 分钟等于对人家做压测
                throw new BusinessException(400, "同步周期需在 5 ~ 10080 分钟之间（7 天）");
            }
            rule.put("interval_minutes", minutes);
            ruleChanged = true;
        }
        if (payload.getCategory() != null) {
            String category = trimToNull(payload.getCategory());
            if (category == null) {
                rule.remove("category");
            } else {
                rule.put("category", category);
            }
            ruleChanged = true;
        }
        if (payload.getSelector() != null) {
            NewsSourceUpdateDto.Selector selector = payload.getSelector();
            putOrRemove(rule, "selector", trimToNull(selector.getList()));
            putOrRemove(rule, "titleField", trimToNull(selector.getTitle()));
            putOrRemove(rule, "dateField", trimToNull(selector.getPublished_at()));
            ruleChanged = true;
        }
        if (ruleChanged) {
            source.setSyncRule(rule.toString());
            changed = true;
        }

        if (!changed) {
            throw new BusinessException(400, "没有需要变更的内容");
        }
        source.setUpdatedAt(LocalDateTime.now(ZONE));
        updateById(source);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("id", source.getId());
        data.put("status", Boolean.FALSE.equals(source.getIsEnabled()) ? "paused" : "active");
        data.put("sync_interval_minutes", rule.hasNonNull("interval_minutes")
                ? rule.get("interval_minutes").asInt() : null);
        data.put("updated_at", source.getUpdatedAt().toString());
        return new Result<Map<String, Object>>().success(data);
    }

    @Override
    @MyLog(value = "news_source", description = "手动触发新闻源同步")
    public Result<Map<String, Object>> syncSource(String id) {
        adminGuard.requireAdmin();
        NewsSources source = requireSource(id);
        // 先做能在这一层做完的校验，再如实拒绝：这样管理员看到的错因是「源没配地址」
        // 而不是笼统的「未实现」。
        if (Boolean.FALSE.equals(source.getIsEnabled())) {
            throw new BusinessException(409, "该新闻源已停用，请先启用再同步");
        }
        if (trimToNull(source.getSourceUrl()) == null) {
            throw new BusinessException(400, "该新闻源没有配置源地址（source_url），无法同步");
        }
        throw new BusinessException(501,
                "同步执行器尚未部署：本项目没有实现新闻抓取（Java 与 Python 两侧都没有爬取作业），"
                        + "因此不会创建同步任务。抓取作业落地后此接口即可直接使用。");
    }

    // ------------------------------------------------------------------ 内部工具

    private NewsSources requireSource(String id) {
        if (id == null || id.isBlank()) {
            throw new BusinessException(400, "缺少新闻源 id");
        }
        NewsSources source = getById(id);
        if (source == null) {
            throw new NotFoundException("新闻源不存在：" + id);
        }
        return source;
    }

    /** 「全部」哨兵与空串不算筛选条件。 */
    private static boolean hasFilter(String value) {
        return value != null && !value.isBlank() && !"all".equalsIgnoreCase(value.trim());
    }

    /**
     * 契约状态 → {@code is_enabled}。
     *
     * @return {@code true}={@code active}、{@code false}={@code paused}；无法识别时 {@code null}
     *         （由调用方报 400，绝不默认成「不限」或「启用」）
     */
    private static Boolean toEnabled(String status) {
        String normalized = status.trim().toLowerCase();
        return switch (normalized) {
            case "active", "enabled", "on" -> Boolean.TRUE;
            case "paused", "disabled", "off" -> Boolean.FALSE;
            default -> null;
        };
    }

    private NewsSourceVo toVo(NewsSources source) {
        NewsSourceVo vo = new NewsSourceVo();
        vo.setId(source.getId());
        vo.setName(source.getName());
        vo.setBase_url(source.getSourceUrl());
        vo.setStatus(Boolean.FALSE.equals(source.getIsEnabled()) ? "paused" : "active");
        vo.setSource_type(source.getSourceType());
        vo.setLast_synced_at(source.getLastSyncAt() == null ? null : source.getLastSyncAt().toString());
        vo.setLast_sync_status(source.getLastSyncStatus());
        vo.setLast_error(source.getLastError());

        JsonNode rule = readRule(source.getSyncRule());
        vo.setSync_interval_minutes(rule.hasNonNull("interval_minutes") ? rule.get("interval_minutes").asInt() : null);
        vo.setCategory(rule.hasNonNull("category") ? rule.get("category").asText() : null);

        NewsSourceVo.Selector selector = new NewsSourceVo.Selector();
        selector.setList(textOrNull(rule, "selector"));
        selector.setTitle(textOrNull(rule, "titleField"));
        selector.setPublished_at(textOrNull(rule, "dateField"));
        // 三个选择器全空时给 null 而不是空对象：前端据此判断「这个源没配选择器」，
        // 空对象会被渲染成一排空白输入框，看起来像坏了。
        boolean anySelector = selector.getList() != null || selector.getTitle() != null || selector.getPublished_at() != null;
        vo.setSelector(anySelector ? selector : null);
        return vo;
    }

    private static String textOrNull(JsonNode node, String field) {
        return node.hasNonNull(field) ? node.get(field).asText() : null;
    }

    /**
     * 读 {@code sync_rule}。非法 JSON 时 <b>不抛异常</b>（列表不该因为一行脏数据整页 500），
     * 而是返回空对象 —— 但会打 warn 日志，因为那意味着该源的抓取配置在库里已经坏了。
     */
    private static ObjectNode readRule(String json) {
        if (json == null || json.isBlank()) {
            return MAPPER.createObjectNode();
        }
        try {
            JsonNode node = MAPPER.readTree(json);
            return node instanceof ObjectNode objectNode ? objectNode : MAPPER.createObjectNode();
        } catch (Exception e) {
            log.warn("news_sources.sync_rule 不是合法 JSON，按空对象处理：{}", json);
            return MAPPER.createObjectNode();
        }
    }

    private static void putOrRemove(ObjectNode rule, String field, String value) {
        if (value == null) {
            rule.remove(field);
        } else {
            rule.put(field, value);
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
