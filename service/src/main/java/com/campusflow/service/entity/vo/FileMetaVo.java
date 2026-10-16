package com.campusflow.service.entity.vo;

import lombok.Data;

/**
 * {@code GET /files/{file_id}} 的返回体 —— 文件元数据与扫描状态（契约文档 §9）。
 *
 * <h3>为什么字段名是 snake_case</h3>
 * 与 {@link PostFileVo}、以及前端（管理端 {@code types/api.ts} 的 {@code UploadedFile}）
 * 保持一致。前端直接读 {@code file_id} / {@code size_bytes}，改成驼峰会让管理端
 * 「上传 → 轮询 → 建档」这条链拿不到数据。
 *
 * <h3>🔴 status 必须原样透传 {@code files.status}，不要做任何"翻译"</h3>
 * 取值：{@code pending} / {@code uploaded} / {@code scanning} / {@code ready} /
 * {@code rejected} / {@code deleted}。
 * 管理端的 {@code waitForFileReady}（`services/files.ts`）只认三种：
 * <ul>
 *   <li>{@code ready} → 放行，允许把 file_id 交给建档接口；</li>
 *   <li>{@code rejected} → 直接报错「未通过安全扫描」；</li>
 *   <li>其余一律<b>继续轮询</b>（直到 30s 超时返回 null）。</li>
 * </ul>
 * 换句话说：**把 {@code scanning} 说成 {@code ready} 就等于拆掉了安全扫描这道闸门**
 * （契约第 9 章第 3 条：ready 之前业务接口不得引用该 file_id）。
 *
 * @see com.campusflow.service.controller.FilesController#getFile(Long)
 */
@Data
public class FileMetaVo {

    private Long file_id;

    /** 原始文件名（库里的 {@code original_name}）。 */
    private String filename;

    private String content_type;

    private Long size_bytes;

    private String purpose;

    private String status;
}
