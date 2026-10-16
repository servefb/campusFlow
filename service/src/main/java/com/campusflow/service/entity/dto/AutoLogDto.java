package com.campusflow.service.entity.dto;

import lombok.Data;

/**
 * {@code GET /admin/audit-logs} 查询参数（契约 A.10.3）。
 *
 * <h3>2026-09-23 新增两个参数</h3>
 * <ul>
 *   <li>{@code keyword} —— 关键词。此前<b>没有这个参数</b>，管理端的搜索框在真实接口下
 *       静默失效（页面只挂了个 title 说明）。命中范围：操作人姓名 / 账号、动作、
 *       资源类型、IP、资源 id 的字面值。</li>
 *   <li>{@code result} —— 执行结果 {@code success} / {@code failure}。
 *       此前也没有，管理端的「执行结果状态」下拉被错接到了 {@code action} 上
 *       （每选一次就必然 0 行），页面上已置灰并标注「后端不支持」。现在真的支持了，
 *       前端那处置灰需要随之取消（见《接口对接说明.md》）。</li>
 * </ul>
 *
 * <p>⚠️ {@code from} / {@code to} 必须<b>成对</b>给：后端用 {@code between} 处理，
 * 只给一个等于不筛（不是「从某天起」）。这是既有约定，没改。
 *
 * @author JIA
 * @since 2026-09-04
 */
@Data
public class AutoLogDto {

    private Long operator_id;

    private String action;

    private String resource_type;

    /** 关键词：操作人姓名/账号、动作、资源类型、IP、资源 id。 */
    private String keyword;

    /** 执行结果：{@code success} / {@code failure}（{@code audit_logs.result} 的 CHECK 枚举）。 */
    private String result;

    private String from;

    private String to;

    private Integer page;

    private Integer page_size;
}
