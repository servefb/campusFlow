package com.campusflow.service.controller;

import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.AdminUserBatchDto;
import com.campusflow.service.entity.dto.AdminUserCreateDto;
import com.campusflow.service.entity.dto.AdminUserQueryDto;
import com.campusflow.service.entity.dto.AdminUserUpdateDto;
import com.campusflow.service.entity.vo.AdminUserVo;
import com.campusflow.service.entity.vo.UserStatsVo;
import com.campusflow.service.service.IAdminUsersService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 管理端用户与角色（{@code /admin/users*}）。
 *
 * <h3>路径为什么是 {@code /admin/users} 而不是 {@code /admin/users/}</h3>
 * 管理端 {@code services/http.ts} 的 baseURL 已含 {@code /api/v1}，nginx 反代时剥掉该前缀，
 * 所以服务内部就是 {@code /admin/users}。别"顺手"补上 {@code /api/v1}（同 {@code AdminMetricsController}）。
 *
 * <h3>鉴权</h3>
 * {@code JwtInterceptor} 拦 {@code /**}，所以这里天然要 Bearer token；
 * 「必须是管理员」这一层在 {@link IAdminUsersService} 的实现里做（token 里没有角色）。
 *
 * <h3>审计</h3>
 * 写操作（POST / PATCH）由 service 实现类上的 {@code @MyLog} 落 {@code audit_logs}；
 * 读操作<b>刻意不记</b>—— 列表是轮询接口，一个管理员翻十页就是十行审计，
 * 真出事时这些噪声会把「谁改了权限」埋掉。
 *
 * @author JIA
 * @since 2026-09-23
 */
@RestController
@RequestMapping("/admin/users")
@AllArgsConstructor
public class AdminUsersController {

    private final IAdminUsersService adminUsersService;

    /** {@code GET /admin/users/stats} —— 概览行四项读数。 */
    @GetMapping("/stats")
    public Result<UserStatsVo> stats() {
        return adminUsersService.getUserStats();
    }

    /** {@code GET /admin/users} —— 分页 + 关键词 / 部门 / 角色筛选。 */
    @GetMapping
    public Result<BaseQueryVo<AdminUserVo>> list(AdminUserQueryDto query) {
        return adminUsersService.listUsers(query);
    }

    /** {@code POST /admin/users} —— 新建账号 / 邀请管理员。 */
    @PostMapping
    public Result<AdminUserVo> create(@RequestBody AdminUserCreateDto payload) {
        return adminUsersService.createUser(payload);
    }

    /**
     * {@code PATCH /admin/users/{id}} —— 调整角色与状态。
     *
     * <p>用 PATCH 而不是 PUT：请求体里只提交变了的字段（{@code role_key} / {@code status}），
     * 没给的一律不动。用 PUT 的语义会让人以为「没传的字段要被清空」。
     */
    @PatchMapping("/{id}")
    public Result<AdminUserVo> update(@PathVariable("id") Long id, @RequestBody AdminUserUpdateDto payload) {
        return adminUsersService.updateUser(id, payload);
    }

    /** {@code POST /admin/users/batch} —— 批量分配角色 / 批量冻结。 */
    @PostMapping("/batch")
    public Result<Map<String, Object>> batch(@RequestBody AdminUserBatchDto payload) {
        return adminUsersService.batchUpdate(payload);
    }

    /**
     * {@code GET /admin/users/export} —— 导出当前筛选下的名单（CSV，返回预签名下载地址）。
     *
     * <p>⚠️ 路由顺序上它必须写在 {@code /{id}} 之类的模板变量之前（当前没有 GET /{id}，
     * 所以只是留个提醒）：Spring 会优先匹配字面量段，但一旦以后加了 {@code GET /{id}}，
     * 顺序写反就会让「导出」被当成「查 id=export 的用户」。
     */
    @GetMapping("/export")
    public Result<Map<String, Object>> export(AdminUserQueryDto query) {
        return adminUsersService.exportUsers(query);
    }
}
