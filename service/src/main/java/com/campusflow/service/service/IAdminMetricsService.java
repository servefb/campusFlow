package com.campusflow.service.service;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.vo.AdminMetricsAgentsVo;
import com.campusflow.service.entity.vo.AdminMetricsHotQuestionsVo;
import com.campusflow.service.entity.vo.AdminMetricsOverviewVo;
import com.campusflow.service.entity.vo.AdminMetricsTrendsVo;
import com.campusflow.service.entity.vo.KnowledgeHealthVo;

/**
 * 管理员看板 —— 指标类服务（契约文档第 14 章，归业务服务 {@code /admin/metrics/*}）。
 *
 * <p>只被 {@code AdminMetricsController} 调用。所有方法都要求当前登录用户
 * {@code users.role = 'admin'}，校验统一走 {@code support/AdminGuard}
 * （2026-09-23 起：此前是每个实现类各抄一份私有方法）。
 *
 * <h3>2026-09-23 补齐了契约第 14 章剩下的四个接口</h3>
 * {@code overview / trends / agents / hot-questions} 此前在管理端已按契约接好、
 * 真机下一律 404（{@code overview} 更早就落地了，但因为取数把一个 {@code SUM} 的结果
 * 强转成 {@code Integer}，在真库上必然 500）。四个接口的时间窗口口径统一由
 * {@code support/MetricWindow} 给出，不要各自解释 {@code range}。
 *
 * @author JIA
 * @since 2026-09-21
 */
public interface IAdminMetricsService {

    /**
     * 知识库健康指标 {@code GET /admin/metrics/knowledge-health}。
     *
     * @return 文档状态计数、全文索引覆盖、待处理冲突数
     * @throws com.campusflow.common.exception.BusinessException 非管理员时抛出 403
     */
    Result<KnowledgeHealthVo> getKnowledgeHealth();

    /**
     * 区间概览读数 {@code GET /admin/metrics/overview?range=}。
     *
     * @param range {@code today / 7d / 30d}，缺省 {@code today}；其它取值抛 400
     */
    Result<AdminMetricsOverviewVo> getOverview(String range);

    /**
     * 使用趋势 {@code GET /admin/metrics/trends?range=&interval=}。
     *
     * @param range    {@code today / 7d / 30d}
     * @param interval {@code hour / day}；粒度实际由 {@code range} 决定（{@code today→hour}），
     *                 此参数只做取值校验，给错值抛 400 而不是静默忽略
     */
    Result<AdminMetricsTrendsVo> getTrends(String range, String interval);

    /**
     * 智能体调用指标 {@code GET /admin/metrics/agents?range=}。
     */
    Result<AdminMetricsAgentsVo> getAgents(String range);

    /**
     * 高频提问榜 {@code GET /admin/metrics/hot-questions?range=}。
     *
     * @param range 时间窗口
     * @param limit 取前 N 条，缺省 5
     */
    Result<AdminMetricsHotQuestionsVo> getHotQuestions(String range, Integer limit);
}
