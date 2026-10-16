package com.campusflow.service.mapper;

import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 管理看板指标的**只读**查询（契约文档第 14 章 {@code /admin/metrics/*}）。
 *
 * <h3>为什么不挂在各表自己的 Mapper 上</h3>
 * 这些查询都是跨表的聚合投影，没有对应的 {@code PO}，也不是任何单表的 CRUD。
 * 单独开一个只读 Mapper 的好处是：改动面收在一个文件里，不会把聚合 SQL 混进
 * 那些由 MyBatis-Plus 生成的表 Mapper（它们本来是干净的 BaseMapper）。
 *
 * <h3>⚠️ 口径定义（契约 §A.9.4 的样例没写清，本实现按下面口径落地）</h3>
 * <ol>
 *   <li><b>文档状态</b>：{@code knowledge_documents.status} 的库枚举有 <b>6</b> 个
 *       （{@code draft / processing / ready / failed / offline / archived}），
 *       而契约只给了 4 个桶。本实现<b>不合并</b>，6 个桶各自成键，另加一个 {@code total}
 *       供前端校验 —— 合并会导致「草稿被算成下线」这种口径污染，而且永远看不出来少了几条。</li>
 *   <li><b>软删</b>：一律排除 {@code deleted_at IS NOT NULL}。本工程没有 {@code @TableLogic}，
 *       软删不会自动过滤，所以这里必须显式写。</li>
 *   <li><b>切片计数</b>：只算<b>当前版本</b>（{@code is_current = 1}）的切片。
 *       {@code knowledge_document_versions} 上有唯一索引 {@code uq_knowledge_current_version}，
 *       保证一份文档只有一个当前版本；不限定它就会把历史版本的切片重复计入。</li>
 *   <li><b>切片归属</b>：{@code knowledge_sections} 本身没有任何「已索引」标记位，
 *       库里只有一条 {@code FULLTEXT INDEX}（那是 MySQL 自动维护的，全表都在里面）。
 *       所以「已索引 / 待索引」只能按<b>文档状态</b>推导：
 *       {@code ready} 的切片 = 已进入可检索状态；{@code draft/processing} 的切片 = 待索引。
 *       {@code failed / offline / archived} 的切片两边都不计 —— 它们不会自动变成可检索，
 *       归入「待索引」会让人误以为排队能等到。</li>
 * </ol>
 *
 * @see com.campusflow.service.service.impl.AdminMetricsServiceImpl
 */
public interface AdminMetricsMapper {

    /**
     * 文档状态计数 + 已移出（软删）计数。
     *
     * <p>用 {@code SUM(条件)} 一次扫全表拿到全部桶（而不是逐个 {@code COUNT}）：
     * {@code knowledge_documents} 上唯一的复合索引 {@code idx_knowledge_documents_filter}
     * 前导列是 {@code category_id}，所以 {@code WHERE status=?} 用不上它、每次都是全表扫，
     * 打 6 次就是 6 次全扫。这个接口是看板轮询用的，省掉多次全扫值得。
     *
     * <p>⚠️ 返回值是单行 Map，键名大小写取决于 JDBC 驱动的列标签策略，
     * 读的时候必须用不区分大小写的方式取（见 {@code AdminMetricsServiceImpl#number}）。
     * 表为空时 {@code SUM} 返回 {@code NULL}，按 0 处理。
     *
     * <p>🔴 {@code removed} 桶（2026-10-15 补，管理端「移除知识库」页签徽章用）：
     * {@code knowledge_documents.status} 的库枚举里<b>没有</b> {@code 'removed'}，
     * 移出由 AI 服务（Python）打 {@code deleted_at} 软删戳，判据唯一 =
     * {@code deleted_at IS NOT NULL}。因此这里<b>去掉了原来的
     * {@code WHERE deleted_at IS NULL}</b>，把软删过滤下放到每个状态桶的
     * {@code SUM} 条件里 —— 六个状态桶的口径与改前完全一致（仍不含软删行），
     * 多出的 {@code removed} 只数软删行，两不相混。
     */
    @Select("SELECT "
            + "  SUM(deleted_at IS NULL AND status = 'draft')      AS draft, "
            + "  SUM(deleted_at IS NULL AND status = 'processing') AS processing, "
            + "  SUM(deleted_at IS NULL AND status = 'ready')      AS ready, "
            + "  SUM(deleted_at IS NULL AND status = 'failed')     AS failed, "
            + "  SUM(deleted_at IS NULL AND status = 'offline')    AS offline, "
            + "  SUM(deleted_at IS NULL AND status = 'archived')   AS archived, "
            + "  SUM(deleted_at IS NOT NULL)                       AS removed "
            + "FROM knowledge_documents")
    Map<String, Object> selectDocumentStatusCounts();

    /**
     * 已进入可检索状态的切片数（属于 {@code ready} 文档的当前版本）。
     *
     * <p>连接顺序按索引走：{@code knowledge_sections} 先用
     * {@code idx_knowledge_sections_version_chapter(version_id, ...)} 定位切片，
     * 再回 {@code knowledge_document_versions} 判 {@code is_current}。
     */
    @Select("SELECT COUNT(*) "
            + "FROM knowledge_sections s "
            + "JOIN knowledge_document_versions v ON v.id = s.version_id AND v.is_current = 1 "
            + "JOIN knowledge_documents d ON d.id = v.document_id AND d.deleted_at IS NULL "
            + "WHERE d.status = 'ready'")
    long countIndexedSections();

    /**
     * 还没进入可检索状态的切片数（属于 {@code draft} / {@code processing} 文档的当前版本）。
     *
     * <p>不含 {@code failed / offline / archived} —— 见类注释第 4 条。
     */
    @Select("SELECT COUNT(*) "
            + "FROM knowledge_sections s "
            + "JOIN knowledge_document_versions v ON v.id = s.version_id AND v.is_current = 1 "
            + "JOIN knowledge_documents d ON d.id = v.document_id AND d.deleted_at IS NULL "
            + "WHERE d.status IN ('draft', 'processing')")
    long countPendingSections();

    /**
     * 最近一次「全文索引」阶段跑完的时刻。
     *
     * <p>取 {@code knowledge_job_steps} 而不是 {@code knowledge_jobs}：
     * 后者只有 {@code current_stage} 这个「当前/最终停在哪个阶段」的字段，
     * 而 {@code knowledge_job_steps} 才有逐阶段的 {@code completed_at}，
     * 且 {@code (job_id, stage)} 是唯一键，一阶段一行，不会重复计数。
     *
     * <p>一次都没有完成过时返回 {@code null} —— 前端会渲染成 {@code —}，
     * <b>不要</b>在这里回填成当前时间或 0，那会让看板显示一个假的"刚刚索引过"。
     */
    @Select("SELECT MAX(completed_at) FROM knowledge_job_steps "
            + "WHERE stage = 'fulltext_indexing' AND status = 'completed'")
    LocalDateTime selectLastFulltextIndexCompletedAt();

    /**
     * 待处理的文档内容冲突数（{@code knowledge_conflicts.status = 'pending'}）。
     *
     * <p>命中的是 {@code idx_knowledge_conflicts_pending(status, severity, created_at)}。
     * 契约只给总数、不拆严重度 —— 看板要按 {@code severity}（high/medium/low）分级时，
     * 这个索引已经能直接支撑，届时另开一个分组查询即可，不必改表。
     */
    @Select("SELECT COUNT(*) FROM knowledge_conflicts WHERE status = 'pending'")
    long countPendingConflicts();

    // =======================================================================
    // 概览 / 趋势 / 智能体 / 热门问题（2026-09-23 补齐）
    //
    // 统一口径：
    //   · 时间一律右开区间 [from, to)，由 MetricWindow 给出边界；
    //   · messages 一律排除软删（deleted_at IS NOT NULL），本工程没有 @TableLogic；
    //   · 「回答」= role='assistant' 的消息，「提问」= role='user' 的消息。
    // =======================================================================

    /**
     * 提问数（区间内 role='user' 的消息条数）。
     *
     * <p>这是<b>计数</b>，没有数据就是真实的 0，不是缺失值 —— 所以返回 {@code long}
     * 而不是可空包装。
     */
    @Select("SELECT COUNT(*) FROM messages "
            + "WHERE role = 'user' AND deleted_at IS NULL "
            + "AND created_at >= #{from} AND created_at < #{to}")
    long countUserMessages(@Param("from") LocalDateTime from, @Param("to") LocalDateTime to);

    /**
     * 平均响应时长（区间内 assistant 消息的 {@code elapsed_ms} 均值，毫秒）。
     *
     * <p>⚠️ 这是本组接口里最容易出错的取数，历史上就是它把 {@code /admin/metrics/overview}
     * 打成 500 的：老实现写的是 {@code SUM(elapsed_ms) / COUNT(*)} 并声明成
     * {@code Map<String, Integer>}，而
     * <ol>
     *   <li>{@code SUM()} 在 MySQL 里返回 {@code DECIMAL}/{@code Long}，强转 {@code Integer} 直接
     *       {@code ClassCastException}；</li>
     *   <li>用户的提问行 {@code elapsed_ms} 恒为 NULL，{@code SUM} 得到 NULL，
     *       再取整就是空指针。</li>
     * </ol>
     * 现在改成 {@code AVG} + 声明 {@code Double}：{@code AVG} 会<b>自动忽略 NULL</b>
     * （分母只算有耗时的行），全组都没有耗时则返回 NULL —— 那正是「本次没能测到」
     * 的诚实表达，由上层映射成 null 让前端显示「—」。
     */
    @Select("SELECT AVG(elapsed_ms) FROM messages "
            + "WHERE role = 'assistant' AND deleted_at IS NULL AND elapsed_ms IS NOT NULL "
            + "AND created_at >= #{from} AND created_at < #{to}")
    Double avgAssistantElapsed(@Param("from") LocalDateTime from, @Param("to") LocalDateTime to);

    /**
     * 区间内 assistant 消息总数（引用命中率的分母之一）。
     */
    @Select("SELECT COUNT(*) FROM messages "
            + "WHERE role = 'assistant' AND deleted_at IS NULL "
            + "AND created_at >= #{from} AND created_at < #{to}")
    long countAssistantMessages(@Param("from") LocalDateTime from, @Param("to") LocalDateTime to);

    /**
     * 区间内「有据可依」的 assistant 消息数（{@code grounded = 1}，即检索到了知识源）。
     *
     * <p>引用命中率的分母。⚠️ 分母<b>不能</b>用全部 assistant 消息：没检索到知识源的
     * 回答本来就不该带引用，把它算作「没命中」会让这个率恒等于一个很低的数，
     * 而且怎么优化知识库都上不去 —— 那是口径错了，不是指标差。
     */
    @Select("SELECT COUNT(*) FROM messages "
            + "WHERE role = 'assistant' AND deleted_at IS NULL AND grounded = 1 "
            + "AND created_at >= #{from} AND created_at < #{to}")
    long countGroundedAssistantMessages(@Param("from") LocalDateTime from, @Param("to") LocalDateTime to);

    /**
     * 区间内至少挂上一条引用的 assistant 消息数（引用命中率的分子）。
     */
    @Select("SELECT COUNT(DISTINCT m.id) FROM messages m "
            + "JOIN message_citations c ON c.message_id = m.id "
            + "WHERE m.role = 'assistant' AND m.deleted_at IS NULL "
            + "AND m.created_at >= #{from} AND m.created_at < #{to}")
    long countCitedAssistantMessages(@Param("from") LocalDateTime from, @Param("to") LocalDateTime to);

    /**
     * 区间内的评价分布，单行两列：{@code helpful} / {@code total}。
     *
     * <p>{@code SUM(条件)} 在无行时返回 NULL（不是 0），上层按 0 处理；
     * {@code total = 0} 时好评率是<b>未测到</b>而不是 100%，上层必须给 null。
     */
    @Select("SELECT SUM(rating = 'helpful') AS helpful, COUNT(*) AS total "
            + "FROM message_feedback "
            + "WHERE created_at >= #{from} AND created_at < #{to}")
    Map<String, Object> selectFeedbackCounts(@Param("from") LocalDateTime from, @Param("to") LocalDateTime to);

    /**
     * 区间内被人工复核「分流」的 assistant 消息数（存在对应 {@code content_reviews} 工单）。
     */
    @Select("SELECT COUNT(DISTINCT m.id) FROM messages m "
            + "JOIN content_reviews r ON r.message_id = m.id "
            + "WHERE m.role = 'assistant' AND m.deleted_at IS NULL "
            + "AND m.created_at >= #{from} AND m.created_at < #{to}")
    long countRoutedAssistantMessages(@Param("from") LocalDateTime from, @Param("to") LocalDateTime to);

    /**
     * 当前待复核工单数（{@code content_reviews.status = 'pending'}）。
     *
     * <p>⚠️ <b>不随区间变化</b>：它是「此刻积压了多少」，与「看哪个时间段」无关。
     * 按区间去筛它会出现「切成 30 天，待复核从 17 涨到 300」这种把积压量当流量读的错。
     */
    @Select("SELECT COUNT(*) FROM content_reviews WHERE status = 'pending'")
    long countPendingReviews();

    /**
     * 按桶统计提问数。{@code fmt} 由 {@code MetricWindow.sqlBucketFormat()} 给出
     * （小时 {@code %H:00} / 天 {@code %m-%d}），与 {@code MetricWindow.label} 的输出同形。
     *
     * <p>返回值键名大小写取决于 JDBC 驱动，读的时候必须不区分大小写
     * （见 {@code AdminMetricsServiceImpl#num}）。
     */
    @Select("SELECT DATE_FORMAT(created_at, #{fmt}) AS bucket, COUNT(*) AS cnt "
            + "FROM messages "
            + "WHERE role = 'user' AND deleted_at IS NULL "
            + "AND created_at >= #{from} AND created_at < #{to} "
            + "GROUP BY bucket")
    List<Map<String, Object>> selectUserBucketCounts(@Param("from") LocalDateTime from,
                                                     @Param("to") LocalDateTime to,
                                                     @Param("fmt") String fmt);

    /**
     * 按桶统计回答耗时均值（毫秒）。桶内没有任何带耗时的回答时该桶不会出现在结果里，
     * 上层映射成 null（该桶「未测到」）。
     */
    @Select("SELECT DATE_FORMAT(created_at, #{fmt}) AS bucket, AVG(elapsed_ms) AS avg_ms "
            + "FROM messages "
            + "WHERE role = 'assistant' AND deleted_at IS NULL AND elapsed_ms IS NOT NULL "
            + "AND created_at >= #{from} AND created_at < #{to} "
            + "GROUP BY bucket")
    List<Map<String, Object>> selectLatencyBucketAvgs(@Param("from") LocalDateTime from,
                                                      @Param("to") LocalDateTime to,
                                                      @Param("fmt") String fmt);

    /**
     * 按桶统计被人工复核分流的回答数（趋势图第三条线）。
     */
    @Select("SELECT DATE_FORMAT(m.created_at, #{fmt}) AS bucket, COUNT(*) AS cnt "
            + "FROM messages m "
            + "JOIN content_reviews r ON r.message_id = m.id "
            + "WHERE m.role = 'assistant' AND m.deleted_at IS NULL "
            + "AND m.created_at >= #{from} AND m.created_at < #{to} "
            + "GROUP BY bucket")
    List<Map<String, Object>> selectRoutedBucketCounts(@Param("from") LocalDateTime from,
                                                       @Param("to") LocalDateTime to,
                                                       @Param("fmt") String fmt);

    /**
     * 按桶统计回答数（趋势图第三条/第二条线的分母）。
     */
    @Select("SELECT DATE_FORMAT(created_at, #{fmt}) AS bucket, COUNT(*) AS cnt "
            + "FROM messages "
            + "WHERE role = 'assistant' AND deleted_at IS NULL "
            + "AND created_at >= #{from} AND created_at < #{to} "
            + "GROUP BY bucket")
    List<Map<String, Object>> selectAssistantBucketCounts(@Param("from") LocalDateTime from,
                                                          @Param("to") LocalDateTime to,
                                                          @Param("fmt") String fmt);

    /**
     * 区间内整个窗口是否存在任一复核工单。为 0 时趋势图不给「AI 自主解决 / 人工复核分流」
     * 两条线 —— 那两条线是「没分流 = 全自主」的推论，一个工单都没有的窗口里这个推论
     * 只剩一条贴地的 0，画出来比单线更让人误判。
     */
    @Select("SELECT COUNT(*) FROM content_reviews "
            + "WHERE created_at >= #{from} AND created_at < #{to}")
    long countReviewsInWindow(@Param("from") LocalDateTime from, @Param("to") LocalDateTime to);

    /**
     * 按 Agent 聚合调用量、失败数与平均耗时。
     *
     * <p>用 {@code LEFT JOIN} 而不是 {@code INNER JOIN}：{@code agent_runs.selected_agent_id}
     * 指向一个已下线/已删除的 agent 时（实测库里就有一条 {@code selected_agent_id=1001}
     * 而 agents 表只有 1~4），INNER JOIN 会**静默丢掉这些调用**，调用总量对不上
     * {@code agent_runs} 的行数，而且没有任何提示。LEFT JOIN 会把 {@code agent_key} 留空，
     * 上层回填成 {@code agent_<id>} 并如实展示。
     *
     * <p>按 {@code started_at} 而不是 {@code created_at} 分窗：{@code created_at} 是入队时刻，
     * 排队久的请求会被算进错误的时段。
     */
    @Select("SELECT r.selected_agent_id AS agent_id, a.agent_key AS agent_key, a.name AS agent_name, "
            + "  COUNT(*) AS call_count, SUM(r.status = 'failed') AS failed_count, "
            + "  AVG(r.elapsed_ms) AS avg_elapsed_ms "
            + "FROM agent_runs r "
            + "LEFT JOIN agents a ON a.id = r.selected_agent_id "
            + "WHERE r.started_at >= #{from} AND r.started_at < #{to} "
            + "AND r.selected_agent_id IS NOT NULL "
            + "GROUP BY r.selected_agent_id, a.agent_key, a.name "
            + "ORDER BY call_count DESC")
    List<Map<String, Object>> selectAgentStats(@Param("from") LocalDateTime from,
                                               @Param("to") LocalDateTime to);

    /**
     * 按 Agent 取 P95 耗时（最近秩法 nearest-rank）。
     *
     * <p>MySQL 8 <b>没有</b> {@code PERCENTILE_CONT}（那是 Oracle/PostgreSQL 的），
     * 所以用窗口函数自己排：在组内按耗时升序编号，取「名次 ≥ ⌈0.95 × 样本数⌉」
     * 里的最小值，即第 95 百分位。样本很少时（例如 2 条取 P95）它会退化成最大值 ——
     * 这是最近秩法的正常行为，不是 bug。
     */
    @Select("SELECT agent_id, MIN(elapsed_ms) AS p95_elapsed_ms FROM ("
            + "  SELECT selected_agent_id AS agent_id, elapsed_ms, "
            + "    ROW_NUMBER() OVER (PARTITION BY selected_agent_id ORDER BY elapsed_ms) AS rn, "
            + "    COUNT(*) OVER (PARTITION BY selected_agent_id) AS cnt "
            + "  FROM agent_runs "
            + "  WHERE started_at >= #{from} AND started_at < #{to} "
            + "  AND elapsed_ms IS NOT NULL AND selected_agent_id IS NOT NULL"
            + ") t WHERE rn >= CEIL(cnt * 0.95) GROUP BY agent_id")
    List<Map<String, Object>> selectAgentP95(@Param("from") LocalDateTime from,
                                             @Param("to") LocalDateTime to);

    /**
     * 热门问题 Top N：按<b>问题原文</b>分组计数，长文本截到 80 字展示。
     *
     * <p>⚠️ {@code GROUP BY content}（原文）而不是 {@code GROUP BY LEFT(content, 80)}：
     * 后者会把「前 80 字相同、后面不同」的两个不同问题合并成一个，而它看起来完全正常。
     *
     * <p>空串与纯空白提问不计入 —— 那是用户误触发送，不是「热门问题」。
     */
    @Select("SELECT LEFT(content, 80) AS question, COUNT(*) AS cnt "
            + "FROM messages "
            + "WHERE role = 'user' AND deleted_at IS NULL AND TRIM(content) <> '' "
            + "AND created_at >= #{from} AND created_at < #{to} "
            + "GROUP BY content "
            + "ORDER BY cnt DESC, question ASC "
            + "LIMIT #{limit}")
    List<Map<String, Object>> selectHotQuestions(@Param("from") LocalDateTime from,
                                                 @Param("to") LocalDateTime to,
                                                 @Param("limit") int limit);
}
