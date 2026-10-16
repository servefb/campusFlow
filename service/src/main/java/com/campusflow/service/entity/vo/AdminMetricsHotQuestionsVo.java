package com.campusflow.service.entity.vo;

import lombok.Data;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * {@code GET /admin/metrics/hot-questions} 的返回体 —— 高频提问榜（契约文档第 14 章）。
 *
 * <h3>口径</h3>
 * 按<b>问题原文</b>在 {@code messages(role='user')} 里分组计数，降序取前 N。
 * 原文截到 80 字仅用于展示（{@code LEFT(content, 80)}），分组键仍是完整原文 ——
 * 按截断后的文本分组会把「前 80 字相同」的不同问题合并成一个。
 *
 * <h3>⚠️ 两个字段<strong>故意不给</strong>，因为库里没有事实来源</h3>
 * <ol>
 *   <li>{@code category}（「教务 / 奖助学金」这类分类）：{@code messages} 表没有分类列，
 *       引用链（消息 → citation → 文档 → 分类）在本库的数据里也不成立 ——
 *       {@code messages.parent_message_id} 实测<b>全为 NULL</b>，接不上提问与回答。
 *       与其按关键词猜一个分类，不如留空：管理端已改成「无值则不渲染那枚标签」。</li>
 *   <li>{@code helpful_rate}（该问题的好评率）：评价挂在 {@code message_feedback.message_id}
 *       （assistant 回答）上，而提问与回答之间没有可靠的外键。给不出来就不给。</li>
 * </ol>
 * 需要这两个字段，得先由 AI 服务在写消息时补上「提问 → 回答」的关联或分类，属契约缺口，
 * 已登记在《接口对接说明.md》。
 *
 * @see com.campusflow.service.controller.AdminMetricsController#hotQuestions(String)
 */
@Data
public class AdminMetricsHotQuestionsVo {

    private String range;

    private String interval;

    private OffsetDateTime updated_at;

    /** 恒为 {@code true}。 */
    private Boolean data_complete;

    private List<Item> items;

    /** 榜单一行。 */
    @Data
    public static class Item {

        /** 名次，从 1 开始（展示用，不落库）。 */
        private int rank;

        /** 问题原文（展示截断到 80 字）。 */
        private String question;

        /** 区间内被提问的次数。 */
        private long count;

        /** 分类名 —— 本服务给不出，恒为 {@code null}，见类注释。 */
        private String category;

        /** 好评率 —— 本服务给不出，恒为 {@code null}，见类注释。 */
        private Double helpful_rate;
    }
}
