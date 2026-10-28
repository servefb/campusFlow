package com.campusflow.service.entity.po;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.experimental.Accessors;

import java.io.Serializable;
import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 内容审核工单（{@code content_reviews}）。
 *
 * <h3>谁写这张表</h3>
 * 开单方是 AI 服务的规则引擎（置信度低 / 未命中知识源 / 命中敏感词 / 引用失效），
 * 本工程（管理端）只做<b>读队列 + 处置</b>。表结构与索引见
 * {@code db/2026-09-23-admin-console.sql} 第 3 节。
 *
 * <h3>为什么 {@code id} 是 {@code Long} + {@code AUTO}</h3>
 * 建表是 {@code bigint PRIMARY KEY AUTO_INCREMENT}，由 MySQL 生成主键 ——
 * 不要照抄本工程部分历史 PO 的 {@code String id}（那是 MyBatis-Plus 生成器留下的写法，
 * 会让 {@code BigDecimal}/{@code Long} 的映射多一层无意义的字符串转换）。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("content_reviews")
public class ContentReviews implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    /** 被复核的 assistant 消息 id，表上有唯一键（一条消息只开一张单）。 */
    private Long messageId;

    private Long conversationId;

    /** {@code low_confidence / policy_conflict / hallucination / sensitive / stale_citation / security / privacy}。 */
    private String reason;

    /** {@code high / medium / low}。 */
    private String risk;

    /** 开单时的回答置信度，0~1。 */
    private BigDecimal confidence;

    /** 用户原问题（开单时快照，不随消息编辑而变）。 */
    private String question;

    /** 被复核的回答（快照）。 */
    private String answer;

    /** {@code pending / resolved / rejected}。 */
    private String status;

    /** 处置动作 {@code approve / correct / reject}，未处置时为 null。 */
    private String action;

    private String correctedAnswer;

    /**
     * 订正后保留的引用 id 列表，存成 JSON 数组文本（库列 {@code json}）。
     *
     * <p>用文本进出而不是直接映射成 {@code List}：MyBatis 对 {@code json} 列没有内置
     * TypeHandler，硬映射成 {@code List} 会在读取时得到一个 {@code String} 而抛
     * {@code ClassCastException}。序列化/反序列化放在服务层，只此一处。
     */
    private String citationIds;

    private String comment;

    /** 处置人 {@code users.id}。 */
    private Long reviewedBy;

    private LocalDateTime reviewedAt;

    private String agentKey;

    private String model;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
