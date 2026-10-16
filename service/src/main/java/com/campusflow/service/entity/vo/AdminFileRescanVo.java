package com.campusflow.service.entity.vo;

import lombok.Data;

/**
 * {@code POST /admin/files/{id}/rescan} 出参（文件审核台契约草案），
 * 对应管理端 {@code FileReviewRescanResult}。
 *
 * @author JIA
 * @since 2026-10-15
 */
@Data
public class AdminFileRescanVo {

    private Long id;

    /** 重扫后固定为 scanning。 */
    private String status;

    /** 重新入队时间（ISO-8601 含时区偏移）。 */
    private String requeued_at;
}
