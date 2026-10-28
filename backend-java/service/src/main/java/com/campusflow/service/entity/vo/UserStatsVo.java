package com.campusflow.service.entity.vo;

import lombok.Data;

/**
 * {@code GET /admin/users/stats} —— 用户页概览行的四项读数。
 *
 * <h3>每个数字的口径（页面文案要跟得上，否则就是「有数字没含义」）</h3>
 * <ol>
 *   <li>{@code total} —— 全部未软删用户（{@code deleted_at IS NULL}）。对页面文案「校园用户总数」。</li>
 *   <li>{@code active_today} —— 今日（东八区自然日）登录过的用户数，取
 *       {@code users.last_login_at >= 今日 00:00}。它是<b>登录去重人数</b>，
 *       不是事件数：同一人今天登录 8 次只算 1。</li>
 *   <li>{@code admin_seats} —— 已分配管理端角色（{@code user_roles} 有行）的席位数。</li>
 *   <li>{@code pending_identity} —— {@code users.status='pending'} 的账号数，
 *       即「邀请已发、尚未完成统一身份认证核验」。<b>不含</b>学籍待核验的普通学生 ——
 *       本项目没有那种数据，页面小注写死了「新生 / 留学生学籍校验」，
 *       接真接口后该小注需要改成「待激活账号」（已在《接口对接说明.md》登记）。</li>
 * </ol>
 *
 * <p>{@code active_ratio} / {@code admin_ratio} 是上面两项对 {@code total} 的比值，
 * 由后端算好给出：前端再去除一次就会出现「分母口径不一致」的经典问题
 * （页面用 38420 当分母、另一个卡片用 38110 当分母，两个都是「占比」）。
 * {@code total=0} 时返回 {@code 0.0}，不返回 NaN —— JSON 里的 NaN 不是合法 JSON，
 * 会让 axios 抛解析错误，看起来又是一次「接口挂了」。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class UserStatsVo {

    private long total;

    private long active_today;

    private double active_ratio;

    private long admin_seats;

    private double admin_ratio;

    private long pending_identity;
}
