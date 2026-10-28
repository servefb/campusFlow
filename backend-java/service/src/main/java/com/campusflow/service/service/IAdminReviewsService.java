package com.campusflow.service.service;

import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.ReviewQueryDto;
import com.campusflow.service.entity.dto.ReviewResolveDto;
import com.campusflow.service.entity.vo.ReviewItemVo;
import com.campusflow.service.entity.vo.ReviewResolveVo;

/**
 * 人工复核队列（契约文档第 14 章 {@code /admin/reviews*}）。
 *
 * <h3>2026-09-23 新建</h3>
 * 管理端「系统观察」页的待复核队列卡与「内容审核」页此前一律 404：
 * 它们早就按契约接好了，只是后端没有实现。开单方是 AI 服务的规则引擎，
 * 本服务只管<b>读队列 + 处置</b>。
 *
 * <p>⚠️ 表里<b>不预置演示数据</b>。假工单会把「队列是空的」渲染成「有风险待处理」，
 * 比空着更容易让人做出错误判断。所以联调时看到的空列表是真实状态。
 *
 * <p>所有方法都要求当前登录用户是管理员（{@code users.role='admin'}），
 * 校验统一走 {@code support/AdminGuard}。
 *
 * @author JIA
 * @since 2026-09-23
 */
public interface IAdminReviewsService {

    /**
     * 复核队列分页 {@code GET /admin/reviews}。
     *
     * @param query {@code status}（缺省 pending）/ {@code risk} / {@code reason} / 分页；
     *              取值不在枚举内时抛 400，{@code all} 视为不筛
     */
    Result<BaseQueryVo<ReviewItemVo>> getReviews(ReviewQueryDto query);

    /** 工单详情 {@code GET /admin/reviews/{id}}，比列表多一个 {@code citations}。 */
    Result<ReviewItemVo> getReviewDetail(Long id);

    /**
     * 处置工单 {@code POST /admin/reviews/{id}/resolve}。
     *
     * @param id             工单 id
     * @param body           处置动作与订正文案
     * @param idempotencyKey 请求头 {@code Idempotency-Key}，仅用于日志追溯；
     *                       真正的重放保护靠「同 id 同 action 直接返回现状」（见实现注释）
     */
    Result<ReviewResolveVo> resolve(Long id, ReviewResolveDto body, String idempotencyKey);
}
