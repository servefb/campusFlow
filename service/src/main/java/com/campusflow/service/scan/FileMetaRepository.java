package com.campusflow.service.scan;

import com.campusflow.service.service.impl.FileScanServiceImpl;

import java.util.Map;
import java.util.Set;

/**
 * 扫描编排要用的元数据读写抽象，由 {@link FileScanRepository} 落地实现（MySQL {@code files} 表）。
 *
 * <p>把「读什么、写什么」和「怎么编排」分开，编排器就不认识 MyBatis / MinIO / 任何基础设施，
 * 单测里换一个内存实现即可跑通三条状态出口。
 *
 * @see FileScanServiceImpl 编排逻辑
 */
public interface FileMetaRepository {

    /** 一次性取齐编排要用的元数据。返回 {@code null} 表示记录不存在或已逻辑删除。 */
    FileMeta load(long fileId);

    /** 该 purpose 允许的「真实」MIME 白名单（以内容检出为准，不是客户端声明）。 */
    Set<String> allowedTypesFor(String purpose);

    /** {@code uploaded} → {@code scanning}。开始扫描时先落这一步，让「还没被扫」和「正在扫」可区分。 */
    void markScanning(long fileId);

    void markReady(long fileId, Map<String, Object> scanResult);

    void markRejected(long fileId, String reasonCode, Map<String, Object> scanResult);

    /** 保持 scanning：记录原因，等重试或人工处理。 */
    void markPending(long fileId, String reasonCode, Map<String, Object> scanResult);

    /** {@code files} 行里编排真正用到的四列。 */
    record FileMeta(long fileId, String purpose, String originalName, String declaredContentType) {
    }
}
