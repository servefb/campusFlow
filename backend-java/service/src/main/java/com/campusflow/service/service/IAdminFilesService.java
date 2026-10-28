package com.campusflow.service.service;

import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.AdminFileQueryDto;
import com.campusflow.service.entity.dto.AdminFileResolveDto;
import com.campusflow.service.entity.vo.AdminFileRescanVo;
import com.campusflow.service.entity.vo.AdminFileResolveVo;
import com.campusflow.service.entity.vo.AdminFileVo;

/**
 * 文件审核台（契约草案 {@code /admin/files*}）。
 *
 * <p>审的是上传文件（{@code files} 表），承接扫描链里「审了但给不出结论」的转人工件
 * （{@code FileScanRetryServiceImpl.HUMAN_REVIEW_CODES}）与被驳回件的重新处置。
 * 人工复核工单那套（{@code /admin/reviews*}）前端已撤除使用，接口闲置保留、与本服务无关。
 *
 * @author JIA
 * @since 2026-10-15
 */
public interface IAdminFilesService {

    /** 审核列表：按派生态 state / purpose 筛选，uploaded_at 倒序。 */
    Result<BaseQueryVo<AdminFileVo>> list(AdminFileQueryDto query);

    /** 人工处置（approve → ready / reject → rejected），幂等与冲突口径对齐 /admin/reviews/resolve。 */
    Result<AdminFileResolveVo> resolve(Long id, AdminFileResolveDto body, String idempotencyKey);

    /** 重新扫描：仅 rejected / scanning 可重扫，旧结论作废只留补偿计数，重投 file.scan.queue。 */
    Result<AdminFileRescanVo> rescan(Long id);
}
