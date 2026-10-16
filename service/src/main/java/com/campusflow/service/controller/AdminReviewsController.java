package com.campusflow.service.controller;

import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.ReviewQueryDto;
import com.campusflow.service.entity.dto.ReviewResolveDto;
import com.campusflow.service.entity.vo.ReviewItemVo;
import com.campusflow.service.entity.vo.ReviewResolveVo;
import com.campusflow.service.service.IAdminReviewsService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 人工复核队列 —— 契约文档第 14 章 {@code /admin/reviews*}。
 *
 * <h3>路径</h3>
 * 同 {@code AdminMetricsController}：管理端发的是 {@code /api/v1/admin/reviews}，
 * nginx 剥掉 {@code /api/v1} 后到这里，所以服务内部写 {@code /admin/reviews}。
 *
 * <h3>鉴权</h3>
 * {@code JwtInterceptor} 保证有令牌，{@code support/AdminGuard} 保证是管理员。
 *
 * <h3>为什么 {@code @RequestBody} 是真的 Spring 注解</h3>
 * 工程里 {@code AuditLogsController} 那个同名的 {@code @RequestBody} 是 Swagger 注解、
 * 参数其实从 query 绑定（那是历史遗留，已在该类注释里标注、<b>不要</b>照抄）。
 * 这里处置接口确实要吃 JSON body（{@code services/metrics.ts} 用 {@code http.post} 发的），
 * 所以用的是 {@code org.springframework.web.bind.annotation.RequestBody}。
 *
 * @author JIA
 * @since 2026-09-23
 */
@RestController
@RequestMapping("/admin/reviews")
@AllArgsConstructor
public class AdminReviewsController {

    private IAdminReviewsService adminReviewsService;

    /**
     * 复核队列分页。
     *
     * <p>参数直接由 Spring 绑到 {@link ReviewQueryDto}（无注解的 POJO 参数默认按 query 绑定），
     * 不逐个写 {@code @RequestParam} —— 参数一多，漏一个就是「筛选静默失效」。
     */
    @GetMapping
    public Result<BaseQueryVo<ReviewItemVo>> list(ReviewQueryDto query) {
        return adminReviewsService.getReviews(query);
    }

    @GetMapping("/{id}")
    public Result<ReviewItemVo> detail(@PathVariable Long id) {
        return adminReviewsService.getReviewDetail(id);
    }

    /**
     * 处置工单（通过 / 订正 / 驳回）。
     *
     * @param idempotencyKey 管理端每次点击生成一个，重试时原样带回。
     *                       {@code required = false}：缺了也能正常处置，只是失去重放追溯
     */
    @PostMapping("/{id}/resolve")
    public Result<ReviewResolveVo> resolve(@PathVariable Long id,
                                          @RequestBody ReviewResolveDto body,
                                          @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return adminReviewsService.resolve(id, body, idempotencyKey);
    }
}
