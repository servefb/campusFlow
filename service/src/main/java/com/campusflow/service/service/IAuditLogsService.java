package com.campusflow.service.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.AutoLogDto;
import com.campusflow.service.entity.po.AuditLogs;
import com.campusflow.service.entity.vo.AuditSummaryVo;
import com.campusflow.service.support.AuditExport;

/**
 * 审计日志查询（契约文档第 15 章，{@code /admin/audit-logs*}）。
 *
 * @author JIA
 * @since 2026-09-04
 */
public interface IAuditLogsService extends IService<AuditLogs> {

    /**
     * {@code GET /admin/audit-logs} —— 分页 + 关键词 / 操作人 / 动作 / 资源类型 / 结果 / 时间窗筛选。
     *
     * <p>🔴 <b>空结果返回 HTTP 200 + 空列表</b>，不再返回 {@code Result.failure(404, "No records found")}。
     * 旧行为有两个问题：① 语义错位 —— 「这个筛选条件没有匹配」不是「接口不存在」；
     * ② 前端必须为它写专门容错，否则 {@code data: null} 会让页面直接白屏
     * （axios 不把 200 当异常，于是错误被当成空数据往下传）。
     */
    Result<BaseQueryVo> getAuditLogs(AutoLogDto autoLogDto);

    /**
     * {@code GET /admin/audit-logs/summary} —— 台账概览四项读数，口径见 {@link AuditSummaryVo}。
     *
     * <p>新增原因：管理端概览行的四项在真实接口下恒为「—」（其中「今日累计审计事件」
     * 还借了分页 {@code total} 兜底，语义并不对：那是「当前筛选窗口的总数」不是「今日」）。
     */
    Result<AuditSummaryVo> getAuditSummary();

    /**
     * {@code GET /admin/audit-logs/export} —— 按与列表**完全相同**的筛选条件导出 CSV。
     *
     * <p>为什么是同步文件流而不是「导出任务 + 下载链接」：管理端原型的文案是
     * 「导出任务已创建，完成后可在通知中心下载」，但那需要一套异步任务与通知中心，
     * 本工程都没有（通知中心只有表、没有产出方）。而审计日志是低频小数据量
     * （2026-09-23 实测全表 90 行、跨度 20 天），同步导出是**当场可用**的那个方案。
     *
     * <p>「筛选条件与列表完全一致」是靠两侧共用 {@code buildWrapper} 保证的 ——
     * 各写一份的结局必然是「列表筛出 3 条、导出却是全部」。
     *
     * @return CSV 内容 + 行数 + 是否截断，见 {@link AuditExport}
     */
    AuditExport exportAuditLogs(AutoLogDto autoLogDto);
}
