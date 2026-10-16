package com.campusflow.service.support;

/**
 * 一次审计日志导出的结果。
 *
 * <h3>为什么要带上 {@code truncated} / {@code limit}</h3>
 * 导出接口不返回 {@code Result} 包络（它回的是文件流，外面再套一层 JSON 就没法直接存盘了），
 * 所以「导了多少、有没有截断」这些信息只能走响应头。而<b>静默截断是不可接受的</b>：
 * 管理员拿到一个 5 万行的文件，会当成「全部日志」去做合规归档 ——
 * 少掉的那部分没有任何痕迹，比导出失败还危险。
 *
 * <p>当前库里 {@code audit_logs} 只有 90 行，离上限很远；这条约束是给将来准备的，
 * 成本只是多三个响应头。
 *
 * @param content   完整 CSV 字节（已含 UTF-8 BOM），可直接写进响应体
 * @param rows      实际导出的数据行数（不含表头）
 * @param limit     本次生效的行数上限
 * @param truncated 是否因为触到上限而截断
 *
 * @author JIA
 * @since 2026-09-23
 */
public record AuditExport(byte[] content, int rows, int limit, boolean truncated) {
}
