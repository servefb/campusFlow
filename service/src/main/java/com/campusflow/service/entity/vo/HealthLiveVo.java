package com.campusflow.service.entity.vo;

import lombok.Data;

import java.time.OffsetDateTime;

/**
 * {@code GET /health/live} 的返回体 —— 进程存活探针（契约文档 §A.10.1）。
 *
 * <h3>live 与 ready 是两件事，别合并</h3>
 * <ul>
 *   <li>{@code live} 只回答「这个进程还活着吗」，<b>不碰任何外部依赖</b> ——
 *       它失败只意味着进程该被重启。</li>
 *   <li>{@code ready} 挨个探一遍依赖，回答「现在能不能接流量」（见 {@link HealthReadyVo}）。</li>
 * </ul>
 * 所以本实现刻意不查库、不连对象存储：一旦 live 也去探依赖，数据库抖动会让编排系统
 * 杀掉一堆本来健康的进程去重启，把一次小故障放大成雪崩。
 * 「进程活着」这个事实由「HTTP 200 本身」承载，不需要额外探测来证明。
 *
 * <h3>为什么字段名是 snake_case</h3>
 * 与 {@link KnowledgeHealthVo} 一致 —— 契约样例里就是字面写法。
 */
@Data
public class HealthLiveVo {

    /** 固定 {@code "up"}：能进到这个方法就说明进程活着。 */
    private String status;

    /** 服务标识，固定 {@code "campus-flow-api"}。多实例部署时用它区分"是谁答的"。 */
    private String service;

    /** 应答时刻，东八区、精确到秒（契约样例 {@code 2026-09-04T16:00:00+08:00}）。 */
    private OffsetDateTime timestamp;
}
