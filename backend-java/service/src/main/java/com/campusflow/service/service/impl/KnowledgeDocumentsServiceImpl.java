package com.campusflow.service.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.exception.BusinessException;
import com.campusflow.common.exception.NotFoundException;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.KnowledgeDocumentDto;
import com.campusflow.service.entity.po.KnowledgeCategories;
import com.campusflow.service.entity.po.KnowledgeConflicts;
import com.campusflow.service.entity.po.KnowledgeDocumentVersions;
import com.campusflow.service.entity.po.KnowledgeDocuments;
import com.campusflow.service.entity.po.KnowledgeSections;
import com.campusflow.service.entity.po.Organizations;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.entity.vo.KnowledgeDocumentDetailVo;
import com.campusflow.service.entity.vo.KnowledgeDocumentVo;
import com.campusflow.service.mapper.KnowledgeDocumentsMapper;
import com.campusflow.service.service.IKnowledgeCategoriesService;
import com.campusflow.service.service.IKnowledgeConflictsService;
import com.campusflow.service.service.IKnowledgeDocumentsService;
import com.campusflow.service.service.IKnowledgeDocumentVersionsService;
import com.campusflow.service.service.IKnowledgeSectionsService;
import com.campusflow.service.service.IOrganizationsService;
import com.campusflow.service.service.IUsersService;
import com.campusflow.service.support.KnowledgeVisibility;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 知识文档服务实现。
 *
 * <h3>2026-09-23 这一轮修了什么</h3>
 * <ol>
 *   <li><b>{@code category} / {@code status} 参数开始生效</b>。之前 DTO 里没有这两个字段，
 *       前端的分类筛选与「待入库 / 入库失败」页签发出去就被丢掉，页面静静地返回全量 ——
 *       这属于「筛选看着生效、其实没有」，比报错难发现得多。</li>
 *   <li><b>列表不再包含软删文档</b>。此前没有 {@code deleted_at} 过滤（本工程没有
 *       {@code @TableLogic}，不写就不过滤），被删的文档会一直留在治理页上。</li>
 *   <li><b>补齐 8 个此前整列空白的字段</b>（版本 / 状态 / 处理状态 / 最近改动 / 字数 / 页数 /
 *       切片数 / 冲突标记），并修正 {@code issuer} 的语义（原来是 {@code issuer_level}
 *       这种 {@code school} 英文枚举，现在是组织名称）。</li>
 * </ol>
 *
 * <h3>2026-10-15 这一轮修了什么（用户侧「谁可见」）</h3>
 * <ol>
 *   <li>可见性过滤从「visibility = 本人 role 或 public」改为
 *       {@link KnowledgeVisibility} 的统一判定：{@code campus} 不再对非 admin 隐身，
 *       {@code department} 按发文单位匹配，教师可见学生文档 —— 与 Python 检索侧
 *       （{@code tasks_templates_match.py}）的白名单逐字对齐；</li>
 *   <li>普通用户（非 admin）列表与详情<b>只看得见 {@code ready}</b>：下线 / 归档 / 解析失败
 *       的文档对他们是「不存在」，与检索侧同口径。admin 不受影响（治理页要看全部状态）；</li>
 *   <li>详情接口补上可见性 / 软删 / 上线状态校验 —— 此前它<b>完全没有</b>这些检查，
 *       任何登录用户凭 id 可越权读取任意文档，列表防了详情没防等于没防；</li>
 *   <li>错误响应从 {@code IllegalArgumentException}（落全局兜底、HTTP 500）改为
 *       {@code BusinessException} / {@code NotFoundException}（400 / 404），
 *       前端按状态码做的分支终于能走对。</li>
 * </ol>
 *
 * <h3>为什么用「批量补数据」而不是逐条查</h3>
 * 一页 8 条要查 5 张表（分类 / 版本 / 切片 / 组织 / 用户），逐条查就是 40 次往返。
 * 这里统一按 id 批量取回再在内存里拼装：一次分页查询 + 若干次 IN 查询，与页大小无关。
 *
 * @author JIA
 * @since 2026-09-04
 */
@Slf4j
@Service
@AllArgsConstructor
public class KnowledgeDocumentsServiceImpl extends ServiceImpl<KnowledgeDocumentsMapper, KnowledgeDocuments>
        implements IKnowledgeDocumentsService {

    private static final int DEFAULT_PAGE = 1;
    private static final int DEFAULT_PAGE_SIZE = 20;

    /** 普通用户唯一可见的文档状态；admin 不受此限（治理页要看全部状态）。 */
    private static final String DOC_STATUS_READY = "ready";

    /** 冲突表中「待处理」的状态值（{@code knowledge_conflicts.status}）。 */
    private static final String CONFLICT_PENDING = "pending";

    private IOrganizationsService organizationsService;

    private IUsersService usersService;
    private IKnowledgeCategoriesService knowledgeCategoriesService;

    private IKnowledgeDocumentVersionsService knowledgeDocumentVersionsService;

    private IKnowledgeSectionsService knowledgeSectionsService;

    private IKnowledgeConflictsService knowledgeConflictsService;

    /** 用户侧「谁可见」的唯一判定点（列表 / 详情共用）。 */
    private KnowledgeVisibility knowledgeVisibility;

    @Override
    public BaseQueryVo<KnowledgeDocumentVo> getKnowledgeDocuments(KnowledgeDocumentDto knowledgeDocumentDto) {
        if (knowledgeDocumentDto == null) {
            throw new BusinessException(400, "参数为空");
        }
        Users user = knowledgeVisibility.requireUser();

        // 分页参数缺省：不传或传了非法值时给默认值，避免 new Page<>(null, null) 直接 NPE 返回 500
        int pageNo = knowledgeDocumentDto.getPage() == null || knowledgeDocumentDto.getPage() < 1
                ? DEFAULT_PAGE : knowledgeDocumentDto.getPage();
        int pageSize = knowledgeDocumentDto.getPage_size() == null || knowledgeDocumentDto.getPage_size() < 1
                ? DEFAULT_PAGE_SIZE : knowledgeDocumentDto.getPage_size();

        /*
         * 状态筛选：admin 原样透传（治理页要看全部 / 待入库 / 入库失败）；
         * 普通用户只可能看到 ready —— 下线、归档、解析失败的文档对他们就是「不存在」，
         * 与检索侧（Python tasks_templates_match.py 只认 status='ready'）同口径。
         * 显式要其他状态时回空页而不是忽略条件：沿用本类「指定了不存在的分类 → 空页」的约定，
         * 「筛了没反应」比报错难发现，绝不能把筛选项安静吞掉。
         */
        String status = dropStatusSentinel(knowledgeDocumentDto.getStatus());
        if (!knowledgeVisibility.isAdmin(user)) {
            if (status != null && !DOC_STATUS_READY.equals(status)) {
                return new BaseQueryVo<>(new ArrayList<>(), 0L, pageNo, pageSize, false);
            }
            status = DOC_STATUS_READY;
        }

        // 分类筛选解析：null = 不筛；空集合 = 指定了一个库里不存在的分类。
        // 后者必须**返回空页**，不能退回「不过滤」——那等于把「这个分类下没有文档」
        // 显示成「这个分类下有全部文档」。
        List<Long> categoryIds = resolveCategoryIds(knowledgeDocumentDto);
        if (categoryIds != null && categoryIds.isEmpty()) {
            return new BaseQueryVo<>(new ArrayList<>(), 0L, pageNo, pageSize, false);
        }

        String keyword = trimToNull(knowledgeDocumentDto.getQuery());

        Page<KnowledgeDocuments> page = lambdaQuery()
                .in(categoryIds != null, KnowledgeDocuments::getCategoryId, categoryIds)
                .eq(knowledgeDocumentDto.getValidity() != null, KnowledgeDocuments::getValidity, knowledgeDocumentDto.getValidity())
                .eq(status != null, KnowledgeDocuments::getStatus, status)
                .and(keyword != null, w -> w
                        .like(KnowledgeDocuments::getTitle, keyword)
                        .or()
                        .like(KnowledgeDocuments::getDocumentNo, keyword)
                        .or()
                        .like(KnowledgeDocuments::getSummary, keyword))
                .and(w -> knowledgeVisibility.applyQuery(w, user))
                .isNull(KnowledgeDocuments::getDeletedAt)
                .orderBy(knowledgeDocumentDto.getSort() != null, Boolean.TRUE.equals(knowledgeDocumentDto.getSort()),
                        KnowledgeDocuments::getCreatedAt)
                .orderByDesc(KnowledgeDocuments::getCreatedAt)
                .page(new Page<>(pageNo, pageSize));

        BaseQueryVo<KnowledgeDocumentVo> vo = new BaseQueryVo<>();
        vo.setItems(enrich(page.getRecords()));
        vo.setTotal(page.getTotal());
        vo.setPage(pageNo);
        vo.setPage_size(pageSize);
        vo.setHas_more(page.hasNext());
        return vo;
    }

    @Override
    public Result<KnowledgeDocumentDetailVo> getKnowledgeDocumentById(String id) {
        Long documentId = parseDocumentId(id);
        // 可见性 / 软删 / 上线状态三道闸都在这里：列表防得住，详情防不住一样是越权
        KnowledgeDocuments doc = knowledgeVisibility.requireVisibleDocument(documentId);

        KnowledgeDocumentDetailVo vo = KnowledgeDocumentDetailVo.builder()
                .id(doc.getId())
                .title(doc.getTitle())
                .document_no(doc.getDocumentNo())
                // validity / visibility 老代码直接 .toString()，列可空时一个 NPE 就是 500
                .validity(doc.getValidity() == null ? null : doc.getValidity().toString())
                .visibility(doc.getVisibility() == null ? null : doc.getVisibility().toString())
                .publishedAt(doc.getPublishedAt() != null ? doc.getPublishedAt().toString() : null)
                .effectiveFrom(doc.getEffectiveFrom() != null ? doc.getEffectiveFrom().toString() : null)
                .build();

        Organizations organization = organizationsService.getById(doc.getIssuerOrganizationId());
        if (organization == null) {
            throw new NotFoundException("文档的发文单位不存在");
        }
        vo.setIssuer(new KnowledgeDocumentDetailVo.Issuer(organization.getId(), organization.getName()));

        KnowledgeCategories knowledgeCategory = knowledgeCategoriesService.getById(doc.getCategoryId());
        if (knowledgeCategory == null) {
            throw new NotFoundException("文档的分类不存在");
        }
        vo.setCategory(new KnowledgeDocumentDetailVo.Category(knowledgeCategory.getId(), knowledgeCategory.getName()));

        /*
         * 当前版本：is_current 优先、id 倒序兜底（与列表 enrich 的选取规则一致）。
         * 不用 .one() 裸查 —— 一文档多版本时它抛 TooManyResults，直接 500。
         */
        List<KnowledgeDocumentVersions> versions = knowledgeDocumentVersionsService.lambdaQuery()
                .eq(KnowledgeDocumentVersions::getDocumentId, doc.getId())
                .orderByDesc(KnowledgeDocumentVersions::getIsCurrent)
                .orderByDesc(KnowledgeDocumentVersions::getId)
                .last("LIMIT 1")
                .list();
        if (versions.isEmpty()) {
            throw new NotFoundException("文档没有可用版本");
        }
        KnowledgeDocumentVersions version = versions.get(0);
        vo.setSignature(new KnowledgeDocumentDetailVo.Signature(version.getSignatureAlgorithm(), version.getSignatureDigest(), version.getSignatureVerified()));
        vo.setIndex(new KnowledgeDocumentDetailVo.Index(
                version.getStatus(),
                version.getUpdatedAt() == null ? null : version.getUpdatedAt().toString()));
        return new Result<KnowledgeDocumentDetailVo>().success(vo);
    }

    // ------------------------------------------------------------------ 内部：筛选解析与字段补全

    /**
     * 把「分类名」筛选解析成分类 id 集合。
     *
     * @return {@code null} 表示没有分类筛选；空集合表示**指定了但不匹配任何分类**
     */
    private List<Long> resolveCategoryIds(KnowledgeDocumentDto dto) {
        if (dto.getCategory_id() != null) {
            return List.of(dto.getCategory_id());
        }
        String categoryName = trimToNull(dto.getCategory());
        if (categoryName == null) {
            return null;
        }
        List<KnowledgeCategories> matched = knowledgeCategoriesService.lambdaQuery()
                .eq(KnowledgeCategories::getName, categoryName)
                .list();
        if (matched.isEmpty()) {
            log.info("按分类名筛选但库中没有该分类：{}", categoryName);
            return List.of();
        }
        return matched.stream().map(KnowledgeCategories::getId).toList();
    }

    /**
     * 批量补全列表项。
     *
     * <p>任何一步取不到都只让对应字段为 {@code null}（前端渲染「—」），
     * <b>绝不填占位值</b>：这一族字段之所以存在，就是因为「空白像 bug、假值像事实」。
     */
    private List<KnowledgeDocumentVo> enrich(List<KnowledgeDocuments> records) {
        List<KnowledgeDocumentVo> result = new ArrayList<>();
        if (records == null || records.isEmpty()) {
            return result;
        }

        List<Long> docIds = records.stream().map(KnowledgeDocuments::getId).filter(Objects::nonNull).toList();

        // 分类名
        List<Long> categoryIds = records.stream().map(KnowledgeDocuments::getCategoryId)
                .filter(Objects::nonNull).distinct().toList();
        // ⚠️ 空 map 不能用 Map.of()：它是不可变映射，get(null) 直接抛 NPE（message 还是 null，
        // 全局兜底只见 500）。下面三处都会用「库里可空的列」当 key 去 get ——
        // issuer_organization_id / category_id / created_by 都可能为 NULL（本轮实测 campus 文档
        // issuer 全 NULL，已入库页签因此 500）。HashMap.get(null) 返回 null 才是想要的语义。
        Map<Long, String> categoryNames = categoryIds.isEmpty() ? new HashMap<>()
                : knowledgeCategoriesService.lambdaQuery().in(KnowledgeCategories::getId, categoryIds).list().stream()
                .collect(Collectors.toMap(KnowledgeCategories::getId, KnowledgeCategories::getName, (a, b) -> a));

        // 当前版本（版本号 / 页数 / 版本状态）
        Map<Long, KnowledgeDocumentVersions> currentVersionByDoc = new HashMap<>();
        if (!docIds.isEmpty()) {
            List<KnowledgeDocumentVersions> versions = knowledgeDocumentVersionsService.lambdaQuery()
                    .in(KnowledgeDocumentVersions::getDocumentId, docIds)
                    .list();
            for (KnowledgeDocumentVersions version : versions) {
                if (version.getDocumentId() == null) {
                    continue;
                }
                KnowledgeDocumentVersions existing = currentVersionByDoc.get(version.getDocumentId());
                // 优先取 is_current=1；若没有任何一条标记为当前版本，取 id 最大的那条（最近一条）。
                // ⚠️ 不能只按 is_current 过滤：实测有文档的版本行没打这个标记，
                // 那样版本号列又会变回「—」，而它明明有版本。
                boolean better = existing == null
                        || (Boolean.TRUE.equals(version.getIsCurrent()) && !Boolean.TRUE.equals(existing.getIsCurrent()))
                        || (Objects.equals(version.getIsCurrent(), existing.getIsCurrent())
                            && version.getId() != null && existing.getId() != null
                            && version.getId() > existing.getId());
                if (better) {
                    currentVersionByDoc.put(version.getDocumentId(), version);
                }
            }
        }

        // 切片统计（字符数 / 切片数）—— 用 GROUP BY 一次拿全，别逐条 count
        Map<Long, int[]> sectionStats = new HashMap<>();
        List<Long> versionIds = currentVersionByDoc.values().stream()
                .map(KnowledgeDocumentVersions::getId).filter(Objects::nonNull).distinct().toList();
        if (!versionIds.isEmpty()) {
            QueryWrapper<KnowledgeSections> wrapper = new QueryWrapper<>();
            wrapper.select("version_id AS version_id",
                            "COUNT(*) AS section_count",
                            "COALESCE(SUM(CHAR_LENGTH(content)), 0) AS word_count")
                    .in("version_id", versionIds)
                    .groupBy("version_id");
            for (Map<String, Object> row : knowledgeSectionsService.listMaps(wrapper)) {
                Long versionId = asLong(value(row, "version_id"));
                if (versionId == null) {
                    continue;
                }
                sectionStats.put(versionId, new int[]{
                        asInt(value(row, "section_count")), asInt(value(row, "word_count"))});
            }
        }

        // 组织名（发文单位）
        List<Long> orgIds = records.stream().map(KnowledgeDocuments::getIssuerOrganizationId)
                .filter(Objects::nonNull).distinct().toList();
        Map<Long, String> orgNames = orgIds.isEmpty() ? new HashMap<>()
                : organizationsService.lambdaQuery().in(Organizations::getId, orgIds).list().stream()
                .collect(Collectors.toMap(Organizations::getId, Organizations::getName, (a, b) -> a));

        // 最近改动人（created_by 在 PO 里是 String，见 asLong 的注释）
        List<Long> creatorIds = records.stream().map(KnowledgeDocuments::getCreatedBy)
                .map(KnowledgeDocumentsServiceImpl::asLong)
                .filter(Objects::nonNull).distinct().toList();
        Map<Long, String> creatorNames = creatorIds.isEmpty() ? new HashMap<>()
                : usersService.lambdaQuery().in(Users::getId, creatorIds).list().stream()
                .collect(Collectors.toMap(Users::getId, Users::getName, (a, b) -> a));

        // 待处理冲突：冲突表的 document_id 是 varchar
        Set<Long> conflicted = new HashSet<>();
        if (!docIds.isEmpty()) {
            List<String> docIdStrings = docIds.stream().map(String::valueOf).toList();
            for (KnowledgeConflicts conflict : knowledgeConflictsService.lambdaQuery()
                    .in(KnowledgeConflicts::getDocumentId, docIdStrings)
                    .eq(KnowledgeConflicts::getStatus, CONFLICT_PENDING)
                    .list()) {
                try {
                    conflicted.add(Long.valueOf(conflict.getDocumentId()));
                } catch (NumberFormatException e) {
                    log.warn("knowledge_conflicts.document_id 非数字，忽略：{}", conflict.getDocumentId());
                }
            }
        }

        for (KnowledgeDocuments record : records) {
            KnowledgeDocumentVo vo = new KnowledgeDocumentVo();
            vo.setId(record.getId());
            vo.setTitle(record.getTitle());
            vo.setDocument_no(record.getDocumentNo());
            vo.setCategory(categoryNames.get(record.getCategoryId()));
            vo.setValidity(record.getValidity() == null ? null : record.getValidity().toString());
            vo.setPublished_at(record.getPublishedAt() == null ? null : record.getPublishedAt().toString());
            // 发文单位：组织名。查不到就是 null（前端「—」），不再回落成 issuer_level 那种英文枚举
            vo.setIssuer(orgNames.get(record.getIssuerOrganizationId()));
            vo.setStatus(record.getStatus());
            vo.setUpdated_at(record.getUpdatedAt() == null ? null : record.getUpdatedAt().toString());
            // ⚠️ createdBy 在 PO 里是 String，而 creatorNames 的键是 Long —— 直接 get("25")
            // 永远落不中（HashMap 不抛错、只是安静地 null），「最近改动人」整列空白。
            // 统一经 asLong 归一后再查（与上面 creatorIds 的收集口径一致）。
            vo.setUpdated_by(asLong(record.getCreatedBy()) == null ? null : creatorNames.get(asLong(record.getCreatedBy())));
            vo.setHas_conflict(conflicted.contains(record.getId()));

            KnowledgeDocumentVersions version = currentVersionByDoc.get(record.getId());
            if (version != null) {
                vo.setVersion(version.getVersionNo());
                vo.setProcess_state(version.getStatus());
                vo.setPage_count(version.getPageCount());
                int[] stats = sectionStats.get(version.getId());
                vo.setSection_count(stats == null ? 0 : stats[0]);
                vo.setWord_count(stats == null ? 0 : stats[1]);
            } else {
                // 没有版本记录：切片数按 0 报（确实没有切片），
                // 但版本号 / 页数 / 处理状态一律留 null —— 「处理中」与「还没开始处理」
                // 在这个字段上分不出来，猜一个就会变成假数据。
                vo.setSection_count(0);
                vo.setWord_count(0);
            }
            result.add(vo);
        }
        return result;
    }

    // ------------------------------------------------------------------ 内部：小工具

    /**
     * 摘掉状态筛选里的「全部」哨兵。
     *
     * <p>前端「全部」页签发的是 {@code all}（管理端冲突 / 作业接口的同款约定），
     * 不能当精确匹配条件下钻 —— 库里没有 {@code status='all'} 的行，
     * 传下去就是「筛出一个永远为空的结果」，看起来像接口坏了。
     */
    private static String dropStatusSentinel(String value) {
        String trimmed = trimToNull(value);
        return trimmed == null || "all".equalsIgnoreCase(trimmed) ? null : trimmed;
    }

    /**
     * 文档 id 路径参数解析：非数字回 400。
     *
     * <p>裸 {@code Long.parseLong} 抛的 NumberFormatException 会落进全局兜底变成 500，
     * 「id 填错了」和「服务挂了」在前端是两个完全不同的分支。
     */
    private static Long parseDocumentId(String id) {
        String text = id == null ? null : id.trim();
        if (text == null || text.isEmpty()) {
            throw new BusinessException(400, "缺少文档 id");
        }
        try {
            return Long.valueOf(text);
        } catch (NumberFormatException e) {
            throw new BusinessException(400, "文档 id 不合法：" + text);
        }
    }

    /** 不区分大小写地从结果行里取值（列标签大小写由 JDBC 驱动决定，同 AdminMetricsServiceImpl 的注释）。 */
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

    private static Long asLong(Object value) {
        if (value instanceof Number number) {
            return number.longValue();
        }
        // ⚠️ 本工程部分历史 PO 把 bigint 列声明成了 String（例如 knowledge_documents.created_by），
        // 只判 Number 会静默返回 null —— 表现是「最近改动人」整列空白，而且一条日志都没有。
        if (value instanceof String text) {
            try {
                return Long.valueOf(text.trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private static int asInt(Object value) {
        return value instanceof Number number ? number.intValue() : 0;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
