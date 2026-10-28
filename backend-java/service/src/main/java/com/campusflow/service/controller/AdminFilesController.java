package com.campusflow.service.controller;

import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.AdminFileQueryDto;
import com.campusflow.service.entity.dto.AdminFileResolveDto;
import com.campusflow.service.entity.vo.AdminFileRescanVo;
import com.campusflow.service.entity.vo.AdminFileResolveVo;
import com.campusflow.service.entity.vo.AdminFileVo;
import com.campusflow.service.service.IAdminFilesService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 文件审核台 —— 契约草案 {@code /admin/files*}（管理端 {@code services/fileReview.ts}）。
 *
 * <h3>路径</h3>
 * 同 {@code AdminReviewsController}：管理端发的是 {@code /api/v1/admin/files}，
 * nginx 剥掉 {@code /api/v1} 后到这里，所以服务内部写 {@code /admin/files}。
 *
 * <h3>鉴权</h3>
 * {@code JwtInterceptor} 保证有令牌，{@code support/AdminGuard} 保证是管理员。
 *
 * <p>注意：人工复核工单那套是 {@code /admin/reviews*}（前端已撤除使用，闲置保留），
 * 别把两套口径混了。
 *
 * @author JIA
 * @since 2026-10-15
 */
@RestController
@RequestMapping("/admin/files")
@AllArgsConstructor
public class AdminFilesController {

    private IAdminFilesService adminFilesService;

    /**
     * 审核列表。
     *
     * <p>参数直接由 Spring 绑到 {@link AdminFileQueryDto}（无注解的 POJO 参数默认按 query 绑定），
     * 不逐个写 {@code @RequestParam} —— 参数一多，漏一个就是「筛选静默失效」。
     */
    @GetMapping
    public Result<BaseQueryVo<AdminFileVo>> list(AdminFileQueryDto query) {
        return adminFilesService.list(query);
    }

    /**
     * 人工处置（approve → ready / reject → rejected）。
     *
     * @param idempotencyKey 管理端每次点击生成一个，重试时原样带回；
     *                       {@code required = false}：缺了也能正常处置，只是失去重放追溯
     */
    @PostMapping("/{id}/resolve")
    public Result<AdminFileResolveVo> resolve(@PathVariable Long id,
                                              @RequestBody AdminFileResolveDto body,
                                              @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return adminFilesService.resolve(id, body, idempotencyKey);
    }

    /** 重新扫描（rejected / scanning → 回队列；ready 409）。 */
    @PostMapping("/{id}/rescan")
    public Result<AdminFileRescanVo> rescan(@PathVariable Long id) {
        return adminFilesService.rescan(id);
    }
}
