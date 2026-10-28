package com.campusflow.service.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.campusflow.common.context.AuditContext;
import com.campusflow.common.exception.BusinessException;
import com.campusflow.common.exception.NotFoundException;
import com.campusflow.common.response.Result;
import com.campusflow.service.aspect.MyLog;
import com.campusflow.service.entity.dto.NewsAdminCreateDto;
import com.campusflow.service.entity.dto.NewsAdminUpdateDto;
import com.campusflow.service.entity.po.CampusNews;
import com.campusflow.service.entity.po.Files;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.mapper.CampusNewsMapper;
import com.campusflow.service.service.IAdminNewsService;
import com.campusflow.service.service.IFilesService;
import com.campusflow.service.support.AdminGuard;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * 管理端新闻发布实现。
 *
 * <h3>三条落地约定</h3>
 * <ol>
 *   <li><b>{@code published_at} 由服务端维护</b>：稿件第一次进入 {@code published} 时补当前时刻。
 *       新闻流按 {@code published_at DESC} 排序，缺了它这一条会永远沉底
 *       （MySQL 降序里 NULL 排在最后）——「发布了但首页看不到」十有八九是这个原因。</li>
 *   <li><b>封面必须已过扫描</b>：{@code cover_file_id} 对应的 {@code files.status} 必须是
 *       {@code ready}（文档第 9 章第 3 条：ready 之前不得引用该 file_id）。
 *       前端可能绕过校验直接调接口，所以这层必须在后端。</li>
 *   <li><b>删除是软删</b>：写 {@code deleted_at}，不物理删除。
 *       新闻被引用在消息引用、书签里，硬删会留下悬空引用。</li>
 * </ol>
 *
 * @author JIA
 * @since 2026-09-23
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdminNewsServiceImpl extends ServiceImpl<CampusNewsMapper, CampusNews> implements IAdminNewsService {

    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    /** 稿件状态，与 {@code campus_news.status} 的 enum 一一对应。 */
    private static final Set<String> ALLOWED_STATUS = Set.of("draft", "published", "offline", "archived");

    /** 可见范围，与 {@code campus_news.visibility} 的 enum 一一对应。 */
    private static final Set<String> ALLOWED_VISIBILITY =
            Set.of("public", "campus", "student", "teacher", "department", "admin");

    /** 一个可接受的多种时间写法：契约给的是 {@code yyyy-MM-dd HH:mm:ss}，前端可能发 ISO。 */
    private static final DateTimeFormatter[] TIME_FORMATS = {
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"),
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss"),
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"),
    };

    private final AdminGuard adminGuard;
    private final IFilesService filesService;

    @Override
    @Transactional(rollbackFor = Exception.class)
    @MyLog(value = "news", description = "发布 / 新建新闻稿")
    public Result<Map<String, Object>> createNews(NewsAdminCreateDto payload) {
        Users admin = adminGuard.requireAdmin();
        if (payload == null) {
            throw new BusinessException(400, "请求体为空");
        }
        String title = requireText(payload.getTitle(), "标题");
        String content = requireText(payload.getContent(), "正文");
        String category = requireText(payload.getCategory(), "分类");

        String status = trimToNull(payload.getStatus()) == null ? "draft" : payload.getStatus().trim();
        requireIn(status, ALLOWED_STATUS, "稿件状态");
        String visibility = trimToNull(payload.getVisibility()) == null ? "campus" : payload.getVisibility().trim();
        requireIn(visibility, ALLOWED_VISIBILITY, "可见范围");
        requireReadyCover(payload.getCover_file_id());

        CampusNews news = new CampusNews()
                .setTitle(title)
                .setContent(content)
                .setCategory(category)
                .setSummary(trimToNull(payload.getSummary()))
                .setVisibility(visibility)
                .setCoverFileId(trimToNull(payload.getCover_file_id()))
                .setIsSpotlight(Boolean.TRUE.equals(payload.getIs_spotlight()))
                .setStatus(status)
                .setDeadlineAt(parseTime(payload.getDeadline_at(), "截止时间"))
                .setCreatedBy(admin.getId() == null ? null : String.valueOf(admin.getId()));
        if ("published".equals(status)) {
            news.setPublishedAt(LocalDateTime.now(ZONE));
        }
        save(news);
        AuditContext.setResource("news", auditIdOf(news.getId()));

        log.info("新建新闻稿：id={}, status={}, 操作人={}", news.getId(), status, admin.getId());
        return new Result<Map<String, Object>>().success(resultOf(news));
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    @MyLog(value = "news", description = "编辑 / 上下线新闻稿")
    public Result<Map<String, Object>> updateNews(String id, NewsAdminUpdateDto payload) {
        adminGuard.requireAdmin();
        CampusNews news = requireNews(id);
        if (payload == null) {
            throw new BusinessException(400, "请求体为空");
        }
        AuditContext.setResource("news", auditIdOf(news.getId()));

        boolean changed = false;
        if (payload.getTitle() != null) {
            news.setTitle(requireText(payload.getTitle(), "标题"));
            changed = true;
        }
        if (payload.getContent() != null) {
            news.setContent(requireText(payload.getContent(), "正文"));
            changed = true;
        }
        if (payload.getSummary() != null) {
            news.setSummary(trimToNull(payload.getSummary()));
            changed = true;
        }
        if (payload.getCategory() != null) {
            news.setCategory(requireText(payload.getCategory(), "分类"));
            changed = true;
        }
        if (payload.getVisibility() != null) {
            requireIn(payload.getVisibility().trim(), ALLOWED_VISIBILITY, "可见范围");
            news.setVisibility(payload.getVisibility().trim());
            changed = true;
        }
        if (payload.getCover_file_id() != null) {
            String coverFileId = trimToNull(payload.getCover_file_id());
            requireReadyCover(coverFileId);
            news.setCoverFileId(coverFileId);
            changed = true;
        }
        if (payload.getIs_spotlight() != null) {
            news.setIsSpotlight(payload.getIs_spotlight());
            changed = true;
        }
        if (payload.getDeadline_at() != null) {
            news.setDeadlineAt(parseTime(payload.getDeadline_at(), "截止时间"));
            changed = true;
        }
        if (payload.getStatus() != null) {
            String status = payload.getStatus().trim();
            requireIn(status, ALLOWED_STATUS, "稿件状态");
            // 首次上线补发布时间；下线/归档**不改**它 —— 下线后再上线不该变成一条「新」新闻，
            // 那会让它在新闻流里窜到最前面，看着像重复推送。
            if ("published".equals(status) && news.getPublishedAt() == null) {
                news.setPublishedAt(LocalDateTime.now(ZONE));
            }
            news.setStatus(status);
            changed = true;
        }
        if (!changed) {
            throw new BusinessException(400, "没有需要变更的内容");
        }

        news.setUpdatedAt(LocalDateTime.now(ZONE));
        updateById(news);
        return new Result<Map<String, Object>>().success(resultOf(news));
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    @MyLog(value = "news", description = "删除新闻稿（软删）")
    public Result<Map<String, Object>> deleteNews(String id) {
        adminGuard.requireAdmin();
        CampusNews news = requireNews(id);
        AuditContext.setResource("news", auditIdOf(news.getId()));
        news.setDeletedAt(LocalDateTime.now(ZONE));
        updateById(news);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("id", news.getId());
        data.put("deleted", true);
        data.put("deleted_at", news.getDeletedAt().toString());
        return new Result<Map<String, Object>>().success(data);
    }

    // ------------------------------------------------------------------ 内部工具

    private CampusNews requireNews(String id) {
        if (id == null || id.isBlank()) {
            throw new BusinessException(400, "缺少新闻 id");
        }
        CampusNews news = getById(id);
        if (news == null || news.getDeletedAt() != null) {
            throw new NotFoundException("新闻不存在（或已删除）：" + id);
        }
        return news;
    }

    private static String requireText(String value, String field) {
        String trimmed = trimToNull(value);
        if (trimmed == null) {
            throw new BusinessException(400, field + "不能为空");
        }
        return trimmed;
    }

    private static void requireIn(String value, Set<String> allowed, String field) {
        if (!allowed.contains(value)) {
            throw new BusinessException(400, field + "取值不合法：" + value
                    + "（可选 " + String.join(" / ", allowed) + "）");
        }
    }

    /** 封面扫描校验：文件必须存在且 {@code status='ready'} —— 否则发布出去的新闻会挂着一张取不到的图。 */
    private void requireReadyCover(String coverFileId) {
        String fileId = trimToNull(coverFileId);
        if (fileId == null) {
            return;
        }
        Files file = filesService.getById(fileId);
        if (file == null) {
            throw new BusinessException(400, "封面文件不存在：" + fileId);
        }
        if (!"ready".equalsIgnoreCase(file.getStatus())) {
            throw new BusinessException(409, "封面文件尚未通过安全扫描（当前状态 "
                    + file.getStatus() + "），扫描完成前不能引用");
        }
    }

    private static LocalDateTime parseTime(String value, String field) {
        String trimmed = trimToNull(value);
        if (trimmed == null) {
            return null;
        }
        for (DateTimeFormatter formatter : TIME_FORMATS) {
            try {
                return LocalDateTime.parse(trimmed, formatter);
            } catch (Exception ignored) {
                // 换下一种格式
            }
        }
        throw new BusinessException(400, field + "格式无法识别：" + value
                + "（支持 yyyy-MM-dd HH:mm:ss）");
    }

    /** 回给出参：只给「调用方需要确认的事实」，不整包回传正文（新闻正文可能很长）。 */
    private Map<String, Object> resultOf(CampusNews news) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("id", news.getId());
        data.put("status", news.getStatus());
        data.put("category", news.getCategory());
        data.put("visibility", news.getVisibility());
        data.put("is_spotlight", news.getIsSpotlight());
        data.put("published_at", news.getPublishedAt() == null ? null : news.getPublishedAt().toString());
        data.put("updated_at", news.getUpdatedAt() == null ? null : news.getUpdatedAt().toString());
        return data;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * {@code campus_news.id} 在 PO 里是 String，但审计表的 {@code resource_id} 是 bigint。
     *
     * <p>直接 {@code Long.valueOf} 会在「id 不是纯数字」时抛 {@code NumberFormatException} ——
     * 那会把一次正常的发布变成 500。审计 id 记不到是小事，业务被审计搞挂是大事，
     * 所以这里解析失败就记空（宁缺勿错，与 {@code AuditContext} 的既有约定一致）。
     */
    private static Long auditIdOf(String id) {
        try {
            return id == null ? null : Long.valueOf(id);
        } catch (NumberFormatException e) {
            log.warn("新闻 id 非数字，审计 resource_id 记空：{}", id);
            return null;
        }
    }
}
