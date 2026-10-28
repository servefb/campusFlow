package com.campusflow.service.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.AdminUserBatchDto;
import com.campusflow.service.entity.dto.AdminUserCreateDto;
import com.campusflow.service.entity.dto.AdminUserQueryDto;
import com.campusflow.service.entity.dto.AdminUserUpdateDto;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.entity.vo.AdminUserVo;
import com.campusflow.service.entity.vo.UserStatsVo;

import java.util.Map;

/**
 * 管理端用户与角色 —— 用户侧服务（{@code /admin/users*}）。
 *
 * <p>这一组接口在《校园事务智能助手后端接口文档》里<b>没有对应章节</b>，路径是按文档既有风格
 * （{@code /admin/*} 前缀、统一 {@link Result} 包络、{@code page}/{@code page_size} 分页）
 * 拟定的，管理端 {@code services/users.ts} 早已按同一套契约接好并标了 {@code RESERVED} ——
 * 两侧字段名必须逐字对齐，改一处要同步另一处。
 *
 * <p>所有方法的第一个动作都是 {@link com.campusflow.service.support.AdminGuard#requireAdmin()}：
 * 权限判断放在实现里，不指望 Controller 或调用方自觉。
 *
 * @author JIA
 * @since 2026-09-23
 */
public interface IAdminUsersService extends IService<Users> {

    /** {@code GET /admin/users/stats} —— 概览行四项读数，口径见 {@link UserStatsVo}。 */
    Result<UserStatsVo> getUserStats();

    /** {@code GET /admin/users} —— 分页用户列表，支持关键词 / 部门 / 角色三个筛选。 */
    Result<BaseQueryVo<AdminUserVo>> listUsers(AdminUserQueryDto query);

    /** {@code POST /admin/users} —— 新建账号 / 邀请管理员（落 {@code pending} 态）。 */
    Result<AdminUserVo> createUser(AdminUserCreateDto payload);

    /** {@code PATCH /admin/users/{id}} —— 调整角色与状态。 */
    Result<AdminUserVo> updateUser(Long id, AdminUserUpdateDto payload);

    /** {@code POST /admin/users/batch} —— 批量分配角色 / 批量冻结。 */
    Result<Map<String, Object>> batchUpdate(AdminUserBatchDto payload);

    /**
     * {@code GET /admin/users/export} —— 导出当前筛选下的用户名单。
     *
     * <p>返回的是 CSV 的临时下载地址（对象存储预签名 URL），不是文件字节流：
     * 管理端只展示「导出任务已创建」，导入导出走对象存储是这个工程既有做法。
     */
    Result<Map<String, Object>> exportUsers(AdminUserQueryDto query);
}
