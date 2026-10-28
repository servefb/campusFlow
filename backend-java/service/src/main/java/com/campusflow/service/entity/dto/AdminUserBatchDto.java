package com.campusflow.service.entity.dto;

import lombok.Data;

import java.util.List;

/**
 * {@code POST /admin/users/batch} —— 批量分配角色 / 批量冻结。
 *
 * <p>请求体形状与前端一致：{@code { user_ids: [...], role_key?, status? }}。
 *
 * <p>⚠️ 全量失败还是部分失败？本实现按<b>逐条</b>处理，返回
 * {@code {affected, skipped, skipped_ids}} —— 不因为一条不存在就把整批回滚。
 * 理由：批量操作的对象是「人」，一条脏 id 让另外 30 条白做，管理员只会更困惑。
 * 但「跳过」必须如实回传（{@code skipped_ids}），不能只回一个 affected 让前端猜。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class AdminUserBatchDto {

    private List<Long> user_ids;

    /** 目标管理端角色 key；null = 不改角色。 */
    private String role_key;

    /** 目标状态；null = 不改状态。 */
    private String status;
}
