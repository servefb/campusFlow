package com.campusflow.service.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.exception.BusinessException;
import com.campusflow.common.response.Result;
import com.campusflow.service.aspect.MyLog;
import com.campusflow.service.entity.dto.ConflictQueryDto;
import com.campusflow.service.entity.dto.ConflictResolveDto;
import com.campusflow.service.entity.dto.KnowledgeJobQueryDto;
import com.campusflow.service.entity.po.KnowledgeConflicts;
import com.campusflow.service.entity.po.KnowledgeDocumentVersions;
import com.campusflow.service.entity.po.KnowledgeDocuments;
import com.campusflow.service.entity.po.KnowledgeJobSteps;
import com.campusflow.service.entity.po.KnowledgeJobs;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.entity.vo.DocumentActionVo;
import com.campusflow.service.entity.vo.KnowledgeConflictVo;
import com.campusflow.service.entity.vo.KnowledgeJobVo;
import com.campusflow.service.mapper.KnowledgeConflictsMapper;
import com.campusflow.service.mapper.KnowledgeDocumentVersionsMapper;
import com.campusflow.service.mapper.KnowledgeDocumentsMapper;
import com.campusflow.service.mapper.KnowledgeJobStepsMapper;
import com.campusflow.service.mapper.KnowledgeJobsMapper;
import com.campusflow.service.mapper.UsersMapper;
import com.campusflow.service.service.IAdminKnowledgeService;
import com.campusflow.service.support.AdminGuard;
import com.campusflow.service.support.MetricWindow;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 知识治理管理端实现（契约文档 11.2 的 {@code /knowledge/admin/*}）。
 *
 * <h3>本类处理的四个真实约束</h3>
 * <ol>
 *   <li><b>生成的 PO 把 bigint 列映射成了 {@code String}</b>（{@code KnowledgeConflicts.id} /
 *       {@code documentId} / {@code resolvedBy} 都是 String）。这是 MyBatis-Plus 生成器的产物，
 *       已在本工程踩过一次（{@code KnowledgeDocumentsServiceImpl#asLong} 就是为它写的）。
 *       这里统一用 {@link #asLong(Object)} 收敛，<b>不要</b>在业务代码里裸写
 *       {@code Long.valueOf(x)} —— 空串会抛异常、null 会 NPE。</li>
 *   <li><b>冲突的严重度不能按字母序排</b>：{@code high < low < medium}，与「高危在前」正好相反。
 *       必须靠 {@code FIELD()} 指定顺序。</li>
 *   <li><b>「归档」是终态</b>：{@code status='archived'} 的文档不能上线也不能下线 ——
 *       它是被替换掉的历史版本，允许它回到检索池会让旧口径重新被引用。</li>
 *   <li><b>「上线」不能只看文档状态</b>：文档 {@code status='ready'} 但当前版本
 *       {@code status <> 'ready'} 是可能的（版本失败/被归档）。检索侧
 *       （{@code repositories/tasks_templates_match.py}）筛的是
 *       {@code knowledge_documents.status='ready'}，所以这里以文档状态为准，
 *       但**当前版本没就绪时拒绝上线**并说明原因，否则会出现「列表显示可检索、
 *       实际引用不到内容」的错位。</li>
 * </ol>
 *
 * <h3>为什么不继承 {@code ServiceImpl<XxxMapper, Xxx>}</h3>
 * 本类横跨 {@code knowledge_conflicts / knowledge_jobs / knowledge_job_steps /
 * knowledge_documents / knowledge_document_versions / users} 六张表，
 * 继承任意一张表的 {@code ServiceImpl} 都是误导（会让人以为主表是它）。
 * 单表 CRUD 的便利在这里本来也用不上：每个方法都要 join 或跨表写。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdminKnowledgeServiceImpl implements IAdminKnowledgeService {

    private static final int DEFAULT_PAGE = 1;
    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;

    private static final ZoneId ZONE = MetricWindow.ZONE;

    /** 前端「全部」筛选片发出来的哨兵值 —— 不能进查询串（既有约定）。 */
    private static final String SENTINEL_ALL = "all";

    /** {@code knowledge_conflicts.status} 的库 CHECK 枚举。 */
    private static final List<String> CONFLICT_STATUS = List.of("pending", "resolved", "ignored");

    /**
     * {@code knowledge_jobs.status} 的库 enum。
     *
     * <p>⚠️ 白名单在这里是**唯一**约束（库是 enum，但 MySQL 对非法值只告警不报错，
     * 静默落成空串）。所以校验必须在应用层做：不认识的取值直接 400，
     * 而不是「当作不过滤」——那会让「筛了没反应」变成看不出来的 bug。
     */
    private static final List<String> JOB_STATUS = List.of("pending", "running", "completed", "failed", "cancelled");

    /** 管理端的三个处置动作，与 {@code services/knowledge.ts} 的入参逐字对应。 */
    private static final List<String> RESOLVE_ACTION = List.of("accept_proposed", "keep_current", "defer");

    /**
     * 动作 → 落库状态。
     *
     * <p>⚠️ {@code defer}（前端叫「二次核实」）落到 {@code ignored}，语义**有偏差**：
     * 库里只有 {@code pending / resolved / ignored} 三个值，没有「挂起」。之所以不选
     * 「保持 pending」，是因为那样处置按钮点了之后列表毫无变化，管理员会以为没生效、
     * 于是反复点。落 {@code ignored} 至少让该条从待办里消失，且 {@code resolution}
     * 里会写清是「deferred」。**这条已登记为待后端确认项**（见《接口对接说明》2.3 节）。
     */
    private static final Map<String, String> ACTION_TO_STATUS = Map.of(
            "accept_proposed", "resolved",
            "keep_current", "resolved",
            "defer", "ignored");

    private static final String DOC_STATUS_READY = "ready";
    private static final String DOC_STATUS_OFFLINE = "offline";
    private static final String DOC_STATUS_ARCHIVED = "archived";
    /** 版本级状态（knowledge_document_versions.status），解析失败用；文档状态里没有它。 */
    private static final String DOC_STATUS_FAILED = "failed";

    private final AdminGuard adminGuard;
    private final KnowledgeConflictsMapper conflictsMapper;
    private final KnowledgeJobsMapper jobsMapper;
    private final KnowledgeJobStepsMapper jobStepsMapper;
    private final KnowledgeDocumentsMapper documentsMapper;
    private final KnowledgeDocumentVersionsMapper versionsMapper;
    private final UsersMapper usersMapper;

    // ------------------------------------------------------------------ 冲突

    @Override
    public Result<BaseQueryVo<KnowledgeConflictVo>> getConflicts(ConflictQueryDto query) {
        adminGuard.requireAdmin();
        ConflictQueryDto q = query == null ? new ConflictQueryDto() : query;

        int pageNo = normalizePage(q.getPage());
        int pageSize = normalizePageSize(q.getPage_size());
        String status = dropSentinel(q.getStatus());
        requireValueOf("冲突状态", status, CONFLICT_STATUS, 400);

        Page<KnowledgeConflicts> page = conflictsMapper.selectPage(new Page<>(pageNo, pageSize),
                new LambdaQueryWrapper<KnowledgeConflicts>()
                        .eq(status != null, KnowledgeConflicts::getStatus, status)
                        /*
                         * 🔴 严重度排序只能写在 last() 里，而且必须写完整。
                         * 两个原因：
                         *  1. FIELD() 无法用 MP 的 orderByXxx 表达；字母序会得到
                         *     high, low, medium（与「高危优先」相反）；
                         *  2. 一旦同时用了 orderByDesc(createdAt)，MP 会先拼出
                         *     `ORDER BY created_at DESC`，last 再追加一个 `ORDER BY ...`，
                         *     两个 ORDER BY 直接是 SQL 语法错误。
                         * 分页插件的 count 查询会把这唯一的 ORDER BY 正确剥离，不受影响。
                         */
                        .last("ORDER BY FIELD(severity, 'high', 'medium', 'low'), created_at DESC, id DESC"));

        BaseQueryVo<KnowledgeConflictVo> vo = new BaseQueryVo<>();
        vo.setItems(toConflictVos(page.getRecords()));
        vo.setTotal(page.getTotal());
        vo.setPage(pageNo);
        vo.setPage_size(pageSize);
        vo.setHas_more(page.hasNext());
        return new Result<BaseQueryVo<KnowledgeConflictVo>>().success(vo);
    }

    @Override
    @MyLog(value = "knowledge", description = "处置知识库条款冲突")
    @Transactional(rollbackFor = Exception.class)
    public Result<KnowledgeConflictVo> resolveConflict(Long id, ConflictResolveDto body) {
        Users admin = adminGuard.requireAdmin();
        if (id == null) {
            throw new BusinessException(400, "缺少冲突 id");
        }
        String action = body == null ? null : trimToNull(body.getAction());
        requireValueOf("处置动作", action, RESOLVE_ACTION, 400);

        KnowledgeConflicts conflict = conflictsMapper.selectById(id);
        if (conflict == null) {
            throw new BusinessException(404, "冲突不存在：" + id);
        }

        String targetStatus = ACTION_TO_STATUS.get(action);
        String resolution = buildResolution(action, body == null ? null : body.getComment());

        String current = trimToNull(conflict.getStatus());
        if (current != null && !"pending".equals(current)) {
            /*
             * 已处置过。判据是「resolution 是否由同一个动作写下」——
             * 我们写入的格式固定以动作码开头（见 buildResolution），
             * 所以 startsWith 就是「同一动作」的判据。
             */
            String existing = conflict.getResolution();
            if (existing != null && existing.startsWith(action)) {
                // 幂等：同动作重放，返回当前状态，不报错也不重复写
                return new Result<KnowledgeConflictVo>().success(toConflictVo(conflict));
            }
            throw new BusinessException(409,
                    "该冲突已处置（当前状态 " + current + "），不能再用「" + action + "」覆盖他人结论");
        }

        LocalDateTime now = LocalDateTime.now(ZONE);
        conflictsMapper.update(null, new LambdaUpdateWrapper<KnowledgeConflicts>()
                .eq(KnowledgeConflicts::getId, id)
                .set(KnowledgeConflicts::getStatus, targetStatus)
                .set(KnowledgeConflicts::getResolution, resolution)
                .set(KnowledgeConflicts::getResolvedBy, admin.getId())
                .set(KnowledgeConflicts::getResolvedAt, now)
                .set(KnowledgeConflicts::getUpdatedAt, now));

        // 回读：让返回值与库里的真实结果一致（含 updated_at 的新值），不用手工拼一个「推测的」结果
        return new Result<KnowledgeConflictVo>().success(toConflictVo(conflictsMapper.selectById(id)));
    }

    /*
     * resolution 的格式约定：`动作码` 或 `动作码：备注`。
     * 之所以自己定：库列是 text、没有任何格式约定，而幂等判据（上面）需要
     * 「这条结论是哪个动作写下的」。若将来要在备注里存结构化内容，
     * 必须同步改这里的解析，否则幂等会失效成 409。
     */
    private static String buildResolution(String action, String comment) {
        String trimmed = trimToNull(comment);
        return trimmed == null ? action : action + "：" + trimmed;
    }

    // ------------------------------------------------------------------ 作业

    @Override
    public Result<BaseQueryVo<KnowledgeJobVo>> getJobs(KnowledgeJobQueryDto query) {
        adminGuard.requireAdmin();
        KnowledgeJobQueryDto q = query == null ? new KnowledgeJobQueryDto() : query;

        int pageNo = normalizePage(q.getPage());
        int pageSize = normalizePageSize(q.getPage_size());
        String status = dropSentinel(q.getStatus());
        requireValueOf("作业状态", status, JOB_STATUS, 400);
        // job_type 是 varchar(32) 无 CHECK，值域开放（当前库里有 ingest），不做白名单

        Page<KnowledgeJobs> page = jobsMapper.selectPage(new Page<>(pageNo, pageSize),
                new LambdaQueryWrapper<KnowledgeJobs>()
                        .eq(status != null, KnowledgeJobs::getStatus, status)
                        .eq(q.getDocument_id() != null, KnowledgeJobs::getDocumentId, q.getDocument_id())
                        .eq(trimToNull(q.getJob_type()) != null, KnowledgeJobs::getJobType, trimToNull(q.getJob_type()))
                        .orderByDesc(KnowledgeJobs::getCreatedAt)
                        .orderByDesc(KnowledgeJobs::getId));

        List<KnowledgeJobs> rows = page.getRecords();
        Map<Long, String> titleById = loadDocumentTitles(documentIdsOfJobs(rows));
        Map<Long, List<KnowledgeJobVo.Stage>> stagesByJob = loadStages(rows);

        List<KnowledgeJobVo> items = new ArrayList<>();
        for (KnowledgeJobs row : rows) {
            KnowledgeJobVo vo = new KnowledgeJobVo();
            Long jobId = asLong(row.getId());
            vo.setJob_id(jobId);
            vo.setDocument_id(asLong(row.getDocumentId()));
            vo.setDocument_title(vo.getDocument_id() == null ? null : titleById.get(vo.getDocument_id()));
            vo.setVersion_id(asLong(row.getVersionId()));
            vo.setJob_type(row.getJobType());
            vo.setStatus(row.getStatus());
            vo.setCurrent_stage(row.getCurrentStage());
            vo.setProgress(row.getProgress());
            vo.setAttempt_count(row.getAttemptCount());
            vo.setError_code(row.getErrorCode());
            vo.setError(row.getErrorMessage());
            vo.setStarted_at(toOffset(row.getStartedAt()));
            vo.setCompleted_at(toOffset(row.getCompletedAt()));
            vo.setCreated_at(toOffset(row.getCreatedAt()));
            // 空数组而不是 null：前端 `.map()` 在 null 上会炸
            vo.setStages(stagesByJob.getOrDefault(jobId, List.of()));
            items.add(vo);
        }

        BaseQueryVo<KnowledgeJobVo> vo = new BaseQueryVo<>();
        vo.setItems(items);
        vo.setTotal(page.getTotal());
        vo.setPage(pageNo);
        vo.setPage_size(pageSize);
        vo.setHas_more(page.hasNext());
        return new Result<BaseQueryVo<KnowledgeJobVo>>().success(vo);
    }

    private static Set<Long> documentIdsOfJobs(List<KnowledgeJobs> rows) {
        Set<Long> ids = new HashSet<>();
        for (KnowledgeJobs row : rows) {
            Long documentId = asLong(row.getDocumentId());
            if (documentId != null) {
                ids.add(documentId);
            }
        }
        return ids;
    }

    /**
     * 按作业批量取阶段明细。
     *
     * <p>⚠️ 三个坑都在这里堵住：
     * <ul>
     *   <li><b>空集合的 {@code IN ()} 是 SQL 语法错误</b>：所以先判空再查。
     *       分页查不到任何作业时，这里就是空集合。</li>
     *   <li><b>顺序不能靠 DB 默认</b>：MySQL 不保证无 ORDER BY 的返回顺序。
     *       按主键升序取，与 {@code run_ingest} 的写入顺序一致
     *       （{@code parsing → chunking → fulltext_indexing → publishing}）。</li>
     *   <li><b>{@code job_id} 在 PO 里是 String</b>：分组前统一归一成 Long，
     *       否则 {@code "97"} 与 {@code 97} 会分成两组。</li>
     * </ul>
     */
    private Map<Long, List<KnowledgeJobVo.Stage>> loadStages(List<KnowledgeJobs> rows) {
        List<Long> jobIds = rows.stream().map(r -> asLong(r.getId())).filter(Objects::nonNull).distinct().toList();
        Map<Long, List<KnowledgeJobVo.Stage>> grouped = new LinkedHashMap<>();
        if (jobIds.isEmpty()) {
            return grouped;
        }
        List<KnowledgeJobSteps> steps = jobStepsMapper.selectList(new LambdaQueryWrapper<KnowledgeJobSteps>()
                .in(KnowledgeJobSteps::getJobId, jobIds)
                .orderByAsc(KnowledgeJobSteps::getId));
        for (KnowledgeJobSteps step : steps) {
            Long jobId = asLong(step.getJobId());
            if (jobId == null) {
                continue;
            }
            KnowledgeJobVo.Stage stage = new KnowledgeJobVo.Stage();
            stage.setStage(step.getStage());
            stage.setStatus(step.getStatus());
            stage.setProgress(step.getProgress());
            // 未完成的阶段 elapsed_ms 本来就为空；补 0 会被读成「瞬间跑完」
            stage.setElapsed_ms(asLong(step.getElapsedMs()));
            grouped.computeIfAbsent(jobId, key -> new ArrayList<>()).add(stage);
        }
        return grouped;
    }

    // ------------------------------------------------------------------ 上线 / 下线

    @Override
    @MyLog(value = "knowledge", description = "上线知识库文档")
    @Transactional(rollbackFor = Exception.class)
    public Result<DocumentActionVo> publishDocument(Long id) {
        adminGuard.requireAdmin();
        KnowledgeDocuments doc = requireDocument(id);
        String previous = trimToNull(doc.getStatus());

        if (DOC_STATUS_ARCHIVED.equals(previous)) {
            // 归档是终态：它是被新版本替换掉的历史口径，回到检索池会让旧规定重新被引用
            throw new BusinessException(409, "文档已归档（archived），不能重新上线。请改为发布新版本。");
        }
        if (DOC_STATUS_READY.equals(previous)) {
            // 幂等：已经是上线状态。回 previous_status 让调用方能如实措辞，而不是假报一次「已更新」
            return new Result<DocumentActionVo>().success(actionVo(doc.getId(), DOC_STATUS_READY, previous));
        }

        KnowledgeDocumentVersions current = selectCurrentVersion(doc.getId());
        if (current == null) {
            throw new BusinessException(409, "该文档没有当前版本，无法上线（先完成入库解析）");
        }
        String versionStatus = trimToNull(current.getStatus());
        /*
         * 版本状态语义：`offline` 是管理员在「下线」时主动跟着文档一起置的（见 offlineDocument），
         * 上线本来就是把这对状态一起复原 —— 必须放行，否则「下线 → 上线」成单行道。
         * 真正要拦的是 `failed`（解析没成功，上线了也检索不到内容）。
         */
        if (DOC_STATUS_FAILED.equals(versionStatus)) {
            throw new BusinessException(409, "当前版本解析失败（version status=failed），请先重建索引再上线");
        }

        LocalDateTime now = LocalDateTime.now(ZONE);
        documentsMapper.update(null, new LambdaUpdateWrapper<KnowledgeDocuments>()
                .eq(KnowledgeDocuments::getId, doc.getId())
                .set(KnowledgeDocuments::getStatus, DOC_STATUS_READY)
                .set(KnowledgeDocuments::getUpdatedAt, now));
        markVersionStatus(current, DOC_STATUS_READY, now);
        /*
         * ⚠️ 刻意不写 published_at。
         * 库列语义是「文件印发时间」（100002 那条是 2026-08-30，与本次操作无关），
         * 拿它当「上线时间」会让印发时间随每次点击漂移，之后没人能还原这份文件到底是什么时候印发的。
         * 「谁在什么时候上线了它」记在 audit_logs（本方法的 @MyLog）。
         */
        log.info("知识文档已上线 documentId={} 原状态={}", doc.getId(), previous);
        return new Result<DocumentActionVo>().success(actionVo(doc.getId(), DOC_STATUS_READY, previous));
    }

    @Override
    @MyLog(value = "knowledge", description = "下线知识库文档")
    @Transactional(rollbackFor = Exception.class)
    public Result<DocumentActionVo> offlineDocument(Long id) {
        adminGuard.requireAdmin();
        KnowledgeDocuments doc = requireDocument(id);
        String previous = trimToNull(doc.getStatus());

        if (DOC_STATUS_ARCHIVED.equals(previous)) {
            throw new BusinessException(409, "文档已归档（archived），无需下线");
        }
        if (DOC_STATUS_OFFLINE.equals(previous)) {
            return new Result<DocumentActionVo>().success(actionVo(doc.getId(), DOC_STATUS_OFFLINE, previous));
        }

        LocalDateTime now = LocalDateTime.now(ZONE);
        documentsMapper.update(null, new LambdaUpdateWrapper<KnowledgeDocuments>()
                .eq(KnowledgeDocuments::getId, doc.getId())
                .set(KnowledgeDocuments::getStatus, DOC_STATUS_OFFLINE)
                .set(KnowledgeDocuments::getUpdatedAt, now));
        /*
         * 版本状态跟着走：检索侧的匹配池查的是 knowledge_documents.status，
         * 但 getPendingKnowledgeFiles 之类的版本视图查的是 versions.status，
         * 两边不一致会出现「文档已下线、版本仍显示 ready」的自相矛盾。
         * 已归档的版本不动 —— 它本来就不参与检索。
         */
        markVersionStatus(selectCurrentVersion(doc.getId()), DOC_STATUS_OFFLINE, now);
        log.info("知识文档已下线 documentId={} 原状态={}", doc.getId(), previous);
        return new Result<DocumentActionVo>().success(actionVo(doc.getId(), DOC_STATUS_OFFLINE, previous));
    }

    private void markVersionStatus(KnowledgeDocumentVersions version, String status, LocalDateTime now) {
        if (version == null || version.getId() == null) {
            return;
        }
        if (DOC_STATUS_ARCHIVED.equals(trimToNull(version.getStatus()))) {
            return;
        }
        versionsMapper.update(null, new LambdaUpdateWrapper<KnowledgeDocumentVersions>()
                .eq(KnowledgeDocumentVersions::getId, version.getId())
                .set(KnowledgeDocumentVersions::getStatus, status)
                .set(KnowledgeDocumentVersions::getUpdatedAt, now));
    }

    /**
     * 取文档，顺带把「已软删」当成不存在。
     *
     * <p>本工程没有 {@code @TableLogic}，{@code deleted_at} 不会自动过滤 ——
     * 不显式判断的话，一个被删掉的文档还能被上线回检索池。
     */
    private KnowledgeDocuments requireDocument(Long id) {
        if (id == null) {
            throw new BusinessException(400, "缺少文档 id");
        }
        KnowledgeDocuments doc = documentsMapper.selectById(id);
        if (doc == null || doc.getDeletedAt() != null) {
            throw new BusinessException(404, "文档不存在：" + id);
        }
        return doc;
    }

    /** 当前版本由唯一索引 {@code uq_knowledge_current_version} 保证至多一条；再加主键倒序兜住历史脏数据。 */
    private KnowledgeDocumentVersions selectCurrentVersion(Long documentId) {
        if (documentId == null) {
            return null;
        }
        return versionsMapper.selectOne(new LambdaQueryWrapper<KnowledgeDocumentVersions>()
                .eq(KnowledgeDocumentVersions::getDocumentId, documentId)
                .eq(KnowledgeDocumentVersions::getIsCurrent, Boolean.TRUE)
                .orderByDesc(KnowledgeDocumentVersions::getId)
                .last("LIMIT 1"));
    }

    private static DocumentActionVo actionVo(Long id, String status, String previousStatus) {
        DocumentActionVo vo = new DocumentActionVo();
        vo.setId(id);
        vo.setStatus(status);
        vo.setPrevious_status(previousStatus);
        return vo;
    }

    // ------------------------------------------------------------------ 内部工具

    /**
     * 冲突行 → 出参，含批量补齐的文档标题与处置人姓名。
     *
     * <p>批量而不是逐条：一页 20 条冲突最多涉及 40 个文档 id、20 个用户 id，
     * 逐条查就是 60 次单表查询。
     */
    private List<KnowledgeConflictVo> toConflictVos(List<KnowledgeConflicts> rows) {
        List<KnowledgeConflictVo> items = new ArrayList<>();
        if (rows == null || rows.isEmpty()) {
            return items;
        }
        Set<Long> docIds = new HashSet<>();
        Set<Long> userIds = new HashSet<>();
        for (KnowledgeConflicts row : rows) {
            addIfPresent(docIds, asLong(row.getDocumentId()));
            addIfPresent(docIds, asLong(row.getConflictingDocumentId()));
            addIfPresent(userIds, asLong(row.getResolvedBy()));
        }
        Map<Long, String> titleById = loadDocumentTitles(docIds);
        Map<Long, String> nameById = loadUserNames(userIds);
        for (KnowledgeConflicts row : rows) {
            items.add(mapConflict(row, titleById, nameById));
        }
        return items;
    }

    /** 单条冲突 → 出参（处置接口回读时用，只多打两次单表查询，量级为 1）。 */
    private KnowledgeConflictVo toConflictVo(KnowledgeConflicts row) {
        if (row == null) {
            return null;
        }
        Set<Long> docIds = new HashSet<>();
        Set<Long> userIds = new HashSet<>();
        addIfPresent(docIds, asLong(row.getDocumentId()));
        addIfPresent(docIds, asLong(row.getConflictingDocumentId()));
        addIfPresent(userIds, asLong(row.getResolvedBy()));
        return mapConflict(row, loadDocumentTitles(docIds), loadUserNames(userIds));
    }

    private static KnowledgeConflictVo mapConflict(KnowledgeConflicts row,
                                                   Map<Long, String> titleById,
                                                   Map<Long, String> nameById) {
        KnowledgeConflictVo vo = new KnowledgeConflictVo();
        vo.setId(asLong(row.getId()));
        vo.setDocument_id(asLong(row.getDocumentId()));
        vo.setDocument_title(vo.getDocument_id() == null ? null : titleById.get(vo.getDocument_id()));
        vo.setConflicting_document_id(asLong(row.getConflictingDocumentId()));
        vo.setConflicting_document_title(
                vo.getConflicting_document_id() == null ? null : titleById.get(vo.getConflicting_document_id()));
        vo.setConflict_type(row.getConflictType());
        vo.setSeverity(row.getSeverity());
        vo.setDescription(row.getDescription());
        vo.setStatus(row.getStatus());
        vo.setResolution(row.getResolution());
        vo.setResolved_by(asLong(row.getResolvedBy()));
        vo.setResolved_by_name(vo.getResolved_by() == null ? null : nameById.get(vo.getResolved_by()));
        vo.setResolved_at(toOffset(row.getResolvedAt()));
        vo.setCreated_at(toOffset(row.getCreatedAt()));
        return vo;
    }

    private Map<Long, String> loadDocumentTitles(Collection<Long> ids) {
        Map<Long, String> titleById = new HashMap<>();
        if (ids == null || ids.isEmpty()) {
            return titleById;
        }
        // KnowledgeDocuments.id 生成成了 Long（这个 PO 被手工修过），可直接 selectBatchIds
        for (KnowledgeDocuments doc : documentsMapper.selectBatchIds(ids)) {
            if (doc.getId() != null) {
                titleById.put(doc.getId(), doc.getTitle());
            }
        }
        return titleById;
    }

    private Map<Long, String> loadUserNames(Collection<Long> ids) {
        Map<Long, String> nameById = new HashMap<>();
        if (ids == null || ids.isEmpty()) {
            return nameById;
        }
        for (Users user : usersMapper.selectBatchIds(ids)) {
            if (user.getId() != null) {
                nameById.put(user.getId(), user.getName());
            }
        }
        return nameById;
    }

    private static void addIfPresent(Set<Long> target, Long value) {
        if (value != null) {
            target.add(value);
        }
    }

    /**
     * 摘掉「全部」哨兵并 trim。
     *
     * <p>后端把筛选项一律当**精确匹配**（判据只有「非 null」），所以传 {@code all}
     * 下去不是「不过滤」而是「永远匹配不上」。这与审计日志接口踩过的坑是同一个（既有约定）。
     */
    private static String dropSentinel(String value) {
        String trimmed = trimToNull(value);
        return trimmed == null || SENTINEL_ALL.equalsIgnoreCase(trimmed) ? null : trimmed;
    }

    /**
     * 校验筛选值在闭集内，否则 400。
     *
     * <p>刻意<b>不做</b>「不认识就忽略」的兜底：那等于把打错的筛选条件变成
     * 「返回全量」，页面看起来一切正常，而用户以为自己在看筛选后的结果。
     */
    private static void requireValueOf(String label, String value, List<String> allowed, int code) {
        if (value != null && !allowed.contains(value)) {
            throw new BusinessException(code, "不支持的" + label + "：" + value + "（可选 " + String.join(" / ", allowed) + "）");
        }
    }

    private static int normalizePage(Integer page) {
        return page == null || page < 1 ? DEFAULT_PAGE : page;
    }

    private static int normalizePageSize(Integer pageSize) {
        return pageSize == null || pageSize < 1 ? DEFAULT_PAGE_SIZE : Math.min(pageSize, MAX_PAGE_SIZE);
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * 宽容的 long 取值。
     *
     * <p>生成器把 bigint 列映射成了 {@code String}，所以这里既可能拿到 {@code Number}
     * （手工修过的 PO，如 {@code KnowledgeDocuments}）也可能拿到 {@code String}
     * （未修过的，如 {@code KnowledgeConflicts}）。空串与非法值一律回 null ——
     * 直接 {@code Long.valueOf} 会在空串上抛 {@code NumberFormatException}，
     * 而那是「数据里有个空字符串」这种完全不值得 500 的情况。
     */
    private static Long asLong(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.longValue();
        }
        if (value instanceof String text) {
            String trimmed = text.trim();
            if (trimmed.isEmpty()) {
                return null;
            }
            try {
                return Long.valueOf(trimmed);
            } catch (NumberFormatException e) {
                log.warn("无法解析成 long 的值：{}", text);
                return null;
            }
        }
        return null;
    }

    /** 库里的 LocalDateTime（东八区墙上时间）→ 带偏移量的 OffsetDateTime，截到秒。与看板接口同一约定。 */
    private static OffsetDateTime toOffset(LocalDateTime localDateTime) {
        return localDateTime == null
                ? null
                : localDateTime.atZone(ZONE).toOffsetDateTime().truncatedTo(ChronoUnit.SECONDS);
    }
}
