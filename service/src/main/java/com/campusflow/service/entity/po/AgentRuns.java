package com.campusflow.service.entity.po;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import java.time.LocalDateTime;
import com.baomidou.mybatisplus.annotation.TableId;
import java.io.Serializable;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.experimental.Accessors;

/**
 * <p>
 * 
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("agent_runs")
public class AgentRuns implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.AUTO)
    private String id;

    private String conversationId;

    private String requestMessageId;

    private String responseMessageId;

    private String selectedAgentId;

    private String status;

    private String routeReason;

    private LocalDateTime startedAt;

    private LocalDateTime completedAt;

    private Integer elapsedMs;

    private String errorCode;

    private String errorMessage;

    private LocalDateTime createdAt;


}
