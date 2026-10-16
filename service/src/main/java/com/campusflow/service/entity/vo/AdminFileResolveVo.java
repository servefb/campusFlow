package com.campusflow.service.entity.vo;

import lombok.Data;

/**
 * {@code POST /admin/files/{id}/resolve} 出参（文件审核台契约草案），
 * 对应管理端 {@code FileReviewResolveResult}。
 *
 * <p>幂等重放时同样返回现状（status 为已落库的终态）。
 *
 * @author JIA
 * @since 2026-10-15
 */
@Data
public class AdminFileResolveVo {

    private Long id;

    /** 处置后的状态：ready（approve）/ rejected（reject）。 */
    private String status;

    /** 本次（或重放前那次）的处置动作。 */
    private String action;

    /** 处置时间（ISO-8601 含时区偏移）。 */
    private String resolved_at;
}
