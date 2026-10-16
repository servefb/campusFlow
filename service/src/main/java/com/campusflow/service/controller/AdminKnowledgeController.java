package com.campusflow.service.controller;

import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.ConflictQueryDto;
import com.campusflow.service.entity.dto.ConflictResolveDto;
import com.campusflow.service.entity.dto.KnowledgeJobQueryDto;
import com.campusflow.service.entity.vo.DocumentActionVo;
import com.campusflow.service.entity.vo.KnowledgeConflictVo;
import com.campusflow.service.entity.vo.KnowledgeJobVo;
import com.campusflow.service.service.IAdminKnowledgeService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 知识治理管理端 —— 契约文档 11.2 的 {@code /knowledge/admin/*}。
 *
 * <h3>路径怎么落到这里</h3>
 * 管理端发的是 {@code /api/v1/knowledge/admin/conflicts}，
 * {@code server.servlet.context-path=/api/v1} 消化掉前缀后路由到这里，
 * 所以类上写 {@code /knowledge/admin}。
 *
 * <h3>⚠️ 不要和脚手架路径混起来</h3>
 * 工程里有 {@code KnowledgeConflictsController}（{@code /knowledge-conflicts}）、
 * {@code KnowledgeJobsController}（{@code /knowledge-jobs}）——这两个是 MyBatis-Plus
 * 生成器的**空壳**（无方法、无鉴权、无分页包络），路径是把表名直接当 URL。
 * 管理端要的是 {@code /knowledge/admin/*}（有 join、有分页、有动作语义），
 * 两者<b>不是同一批接口</b>，别把前端指到空壳上去（那样只会拿到 404）。
 *
 * <h3>鉴权</h3>
 * {@code JwtInterceptor} 保证携带有效令牌，各方法内再经
 * {@code support/AdminGuard#requireAdmin()} 确认是管理员 —— 本工程的
 * {@code JwtInterceptor} 只注入 {@code userId}，不判角色，所以服务层必须自己查。
 *
 * <h3>{@code @RequestBody} 用的是 Spring 的，不是 Swagger 的</h3>
 * 处置冲突要吃 JSON body（{@code services/knowledge.ts} 用 {@code http.post} 发的）。
 * 与 {@code AuditLogsController} 里那个同名的 Swagger 注解<b>无关</b>，
 * 不要照抄那一边（换成 Swagger 那个会让 body 永远绑不上、参数静默为 null）。
 *
 * @author JIA
 * @since 2026-09-23
 */
@RestController
@RequestMapping("/knowledge/admin")
@AllArgsConstructor
public class AdminKnowledgeController {

    private IAdminKnowledgeService adminKnowledgeService;

    /**
     * 条款冲突分页（高危在前）。
     *
     * <p>参数由 Spring 直接绑到 {@link ConflictQueryDto}（无注解的 POJO 参数默认按 query 绑定），
     * 不逐个写 {@code @RequestParam} —— 参数一多，漏一个就是「筛选静默失效」。
     */
    @GetMapping("/conflicts")
    public Result<BaseQueryVo<KnowledgeConflictVo>> listConflicts(ConflictQueryDto query) {
        return adminKnowledgeService.getConflicts(query);
    }

    /**
     * 处置一条冲突：{@code accept_proposed}（采纳新版）/ {@code keep_current}（保留原条款）/
     * {@code defer}（二次核实）。
     *
     * <p>同动作重复提交是幂等的（返回当前状态）；换动作提交回 409，见服务层说明。
     */
    @PostMapping("/conflicts/{id}/resolve")
    public Result<KnowledgeConflictVo> resolveConflict(@PathVariable Long id,
                                                       @RequestBody ConflictResolveDto body) {
        return adminKnowledgeService.resolveConflict(id, body);
    }

    /** 解析 / 索引作业分页，含 4 个阶段的明细。 */
    @GetMapping("/jobs")
    public Result<BaseQueryVo<KnowledgeJobVo>> listJobs(KnowledgeJobQueryDto query) {
        return adminKnowledgeService.getJobs(query);
    }

    /**
     * 上线文档 —— 让它重新进入可检索状态。
     *
     * <p>没有请求体：动作本身不带参数（要改的是状态，不是内容）。
     * 返回体里的 {@code previous_status} 让调用方能区分「这次真的改了」与「本来就是」。
     */
    @PostMapping("/documents/{id}/publish")
    public Result<DocumentActionVo> publishDocument(@PathVariable Long id) {
        return adminKnowledgeService.publishDocument(id);
    }

    /** 下线文档 —— 把它移出可检索状态（不影响已产生的引用留痕）。 */
    @PostMapping("/documents/{id}/offline")
    public Result<DocumentActionVo> offlineDocument(@PathVariable Long id) {
        return adminKnowledgeService.offlineDocument(id);
    }
}
