package com.campusflow.service.entity.vo;

import lombok.Data;

/**
 * {@code GET /admin/users} 列表项，也是 {@code POST /admin/users} 与
 * {@code PATCH /admin/users/{id}} 的返回体。
 *
 * <h3>字段名为什么是 snake_case</h3>
 * 与管理端 {@code types/api.ts → AdminUser} 逐字对齐：前端直接读
 * {@code data.items[].role_name} / {@code last_login_ip}，改成驼峰会静默取到 undefined
 * （页面表现为整列空白，不报错）。
 *
 * <h3>两个 status 别混</h3>
 * <ul>
 *   <li>本 VO 的 {@code status} —— {@code users.status}，管理端语义：
 *       {@code active / pending / locked / disabled}；</li>
 *   <li>{@code users.is_active} —— 历史布尔位，由 service 按 status 同步，<b>不出现在接口里</b>。
 *       两个都暴露等于让前端自己解释矛盾。</li>
 * </ul>
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class AdminUserVo {

    private Long id;

    private String name;

    private String account;

    private String email;

    /** 来自 {@code users.department_name}（不是 organizations.name —— 展示口径与登录响应一致）。 */
    private String department;

    /** 管理端角色标识；未分配管理角色时为 {@code null}，前端渲染「—」。 */
    private String role_key;

    /** 角色中文名；未分配时为 {@code null}。绝不回填成「暂无角色」这类话术 —— 那是文案不是数据。 */
    private String role_name;

    /** {@code active / pending / locked / disabled}。 */
    private String status;

    private String last_login_at;

    private String last_login_ip;

    /** 最近登录网络：内网 / VPN / 校外。未采集到时为 {@code null}。 */
    private String network;

    private String identity_note;
}
