package com.campusflow.service.entity.vo;

import lombok.Data;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * {@code GET /admin/metrics/agents} 的返回体 —— 智能体调用指标（契约文档第 14 章）。
 *
 * <h3>只返回「窗口内有调用」的 Agent</h3>
 * 数据源是 {@code agent_runs}，不是 {@code agents} 表。所以没被调用过的 Agent
 * <b>不会</b>出现在列表里 —— 这一卡的语义是「调用分布 / 按调用量占比重」，
 * 把 0 次调用的 Agent 混进来会让占比分母无谓变大。
 * 当前库里有 4 个已启用 Agent，实际有调用记录的更少，属正常。
 *
 * <h3>⚠️ agent_key 可能回填成 {@code agent_<id>}</h3>
 * {@code agent_runs.selected_agent_id} 指向已被删除/从未入库的 Agent 时，
 * LEFT JOIN 拿不到名字。实现里<b>不丢行也不编名字</b>，回填 {@code agent_<id>} 并让
 * {@code agent_name} 保持 null，前端按 {@code agent_name ?? agent_key} 展示。
 * 丢掉这些行的后果是「总调用量对不上 agent_runs 的行数」，而没有任何提示。
 *
 * @see com.campusflow.service.controller.AdminMetricsController#agents(String)
 */
@Data
public class AdminMetricsAgentsVo {

    private String range;

    private String interval;

    private OffsetDateTime updated_at;

    /** 恒为 {@code true}；若将来 {@code agent_runs} 也不再是可信来源则置 false。 */
    private Boolean data_complete;

    private List<Item> items;

    /** 一个 Agent 的窗口内汇总。 */
    @Data
    public static class Item {

        /** 对应 {@code agents.agent_key}；Agent 已不存在时为 {@code agent_<id>}（见类注释）。 */
        private String agent_key;

        /** 中文展示名。Agent 已不存在时为 {@code null}。 */
        private String agent_name;

        /** 窗口内调用次数。计数型，恒有值（大于 0 才会出现在列表里）。 */
        private long call_count;

        /**
         * 失败率 = {@code status='failed'} 的调用数 ÷ 调用总数。
         *
         * <p>恒有值（分母 ≥ 1）：管理端拿它乘 {@code call_count} 算加权总体失败率，
         * 给 null 会在页面上渲染成 {@code NaN%}。
         */
        private double failure_rate;

        /** 平均耗时（毫秒）。该 Agent 所有调用都没记耗时（{@code elapsed_ms} 全 NULL）时为 {@code null}。 */
        private Long average_elapsed_ms;

        /** P95 耗时（毫秒，最近秩法）。样本全无耗时时为 {@code null}。 */
        private Long p95_elapsed_ms;
    }
}
