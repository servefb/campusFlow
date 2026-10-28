package com.campusflow.service.controller;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.vo.AdminMetricsAgentsVo;
import com.campusflow.service.entity.vo.AdminMetricsHotQuestionsVo;
import com.campusflow.service.entity.vo.AdminMetricsOverviewVo;
import com.campusflow.service.entity.vo.AdminMetricsTrendsVo;
import com.campusflow.service.entity.vo.KnowledgeHealthVo;
import com.campusflow.service.service.IAdminMetricsService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 管理员看板 —— 指标类接口（契约文档第 14 章）。
 *
 * <h3>路径为什么要带 {@code /admin}</h3>
 * 前端按 {@code /api/v1} + {@code /admin/metrics/...} 发起请求（管理端
 * {@code services/http.ts} 的 {@code baseURL}），nginx 反代时<b>会剥掉 {@code /api/v1} 前缀</b>，
 * 所以服务内部的路径就是 {@code /admin/metrics/knowledge-health}。
 * 这里写成 {@code @RequestMapping("/admin/metrics")} 才是对的，不要"顺手"补上 {@code /api/v1}。
 *
 * <h3>鉴权</h3>
 * {@code JwtInterceptor} 拦 {@code /**}，所以这个类天然要求 Bearer token；
 * 「必须是管理员」这层判断统一在 {@code support/AdminGuard} 里做（token 里没有角色）。
 *
 * <h3>2026-09-23：契约第 14 章的指标接口补齐了</h3>
 * 此前只有 {@code knowledge-health}；{@code overview} 虽已声明但在真库上必然 500
 * （{@code SUM} 结果强转 {@code Integer}），{@code trends / agents / hot-questions}
 * 一律 404 —— 管理端早已按契约接好，真机联调时逐个撞上。现在五个接口齐全。
 * 同章还剩 3 个复核接口（{@code /admin/reviews*}），见 {@code AdminReviewsController}。
 *
 * @author JIA
 * @since 2026-09-21
 */
@RestController
@RequestMapping("/admin/metrics")
@AllArgsConstructor
public class AdminMetricsController {

    private IAdminMetricsService adminMetricsService;

    @GetMapping("/knowledge-health")
    public Result<KnowledgeHealthVo> knowledgeHealth() {
        return adminMetricsService.getKnowledgeHealth();
    }

    /**
     * 区间概览读数。
     *
     * @param range {@code today / 7d / 30d}，缺省 today；非法取值由服务层抛 400
     */
    @GetMapping("/overview")
    public Result<AdminMetricsOverviewVo> overview(@RequestParam(required = false) String range) {
        return adminMetricsService.getOverview(range);
    }

    /**
     * 使用趋势（按小时 / 按天分桶）。
     *
     * @param interval {@code hour / day}，只做取值校验；粒度实际由 {@code range} 决定
     */
    @GetMapping("/trends")
    public Result<AdminMetricsTrendsVo> trends(@RequestParam(required = false) String range,
                                               @RequestParam(required = false) String interval) {
        return adminMetricsService.getTrends(range, interval);
    }

    /** 智能体调用指标（只含窗口内有调用的 Agent）。 */
    @GetMapping("/agents")
    public Result<AdminMetricsAgentsVo> agents(@RequestParam(required = false) String range) {
        return adminMetricsService.getAgents(range);
    }

    /**
     * 高频提问榜。
     *
     * @param limit 前 N 条，缺省 5，上限 50
     */
    @GetMapping("/hot-questions")
    public Result<AdminMetricsHotQuestionsVo> hotQuestions(@RequestParam(required = false) String range,
                                                           @RequestParam(required = false) Integer limit) {
        return adminMetricsService.getHotQuestions(range, limit);
    }
}
