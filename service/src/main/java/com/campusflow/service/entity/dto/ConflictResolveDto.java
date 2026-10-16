package com.campusflow.service.entity.dto;

import lombok.Data;

/**
 * {@code POST /knowledge/admin/conflicts/{id}/resolve} 的请求体。
 *
 * <p>动作取值与前端 {@code resolveKnowledgeConflict()} 的第三个参数逐字对应：
 * {@code accept_proposed}（采纳新版）/ {@code keep_current}（保留原条款）/ {@code defer}（二次核实）。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class ConflictResolveDto {

    /** 动作码。非法值一律 400，不做「不认识就当 defer」的兜底。 */
    private String action;

    /** 管理员备注，可选；会合并进 {@code resolution} 字段。 */
    private String comment;
}
