package com.campusflow.service.scan;

import com.campusflow.common.constant.FileConstant;
import com.campusflow.service.entity.po.Files;
import com.campusflow.service.mapper.FilesMapper;
import com.campusflow.tools.fileUtils.MimeCheck;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * {@link FileMetaRepository} 的落地实现：读写 {@code files} 表。
 *
 * <p>状态写回只改 {@code status} / {@code scan_result} 两列 —— MyBatis-Plus 默认忽略 null 字段，
 * 所以构造一个只填了这三个属性（含 id）的实体去 updateById 就是一条最小 patch，
 * 不会把整行覆盖回去、也不会碰 {@code uploaded_at} 之类的列。
 *
 * @see com.campusflow.service.service.impl.FileScanServiceImpl 编排逻辑
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FileScanRepository implements FileMetaRepository {

    /** scan_result 列是 MySQL 的 json 类型，写进去的字符串必须是合法 JSON，所以在这里序列化。 */
    private static final ObjectMapper JSON = new ObjectMapper();

    /** 知识库来源文档。 */
    private static final Set<String> KNOWLEDGE_DOCS = MimeCheck.KNOWLEDGE_DOC_ALLOWED;

    /** 头像。 */
    private static final Set<String> IMAGES = MimeCheck.IMAGE_ALLOWED;

    /** 办事任务材料：可能是件扫描图，也可能是导出的 pdf/word。 */
    private static final Set<String> TASK_MATERIALS = Set.of(
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "image/jpeg",
            "image/png");

    /** 没登记过的 purpose 走这个（宽松兜底），见 {@link #allowedTypesFor} 的注释。 */
    private static final Set<String> DOCS_OR_IMAGES = union(KNOWLEDGE_DOCS, IMAGES);

    private final FilesMapper filesMapper;

    @Override
    public FileMeta load(long fileId) {
        Files f = filesMapper.selectById(fileId);
        if (f == null) {
            log.warn("扫描任务指向的文件不存在：fileId={}（消息重投或数据被清理？）", fileId);
            return null;
        }
        if (f.getDeletedAt() != null) {
            // 已逻辑删除就没必要扫了；更不能往下写状态，否则会把这一行「复活」到前端列表里。
            log.info("文件已逻辑删除，跳过扫描：fileId={}", fileId);
            return null;
        }
        return new FileMeta(
                f.getId(), f.getPurpose(), f.getOriginalName(), f.getContentType());
    }

    /**
     * purpose → 允许的<b>真实</b> MIME 白名单。
     *
     * <p>⚠️ 这里判的是内容检出结果（{@link MimeCheck}），不是客户端声明的 content_type ——
     * 白名单存在的意义就是防「改名伪装」。
     *
     * <p>⚠️ <b>没登记过的 purpose 刻意走宽松兜底，而不是返回空集。</b>
     * 返回空集会让 {@link com.campusflow.service.service.impl.FileScanServiceImpl} 把该 purpose 下的上传
     * 整批判成「无法判定」而卡在 scanning，
     * 一个开发期的字符串笔误就会变成一个线上上传故障。宽松兜底 + WARN 日志，
     * 让问题以「日志里有条警告」的形式暴露，而不是以「用户传不上去」的形式暴露。
     * 新增 purpose 请在此登记（和接口文档里那张表保持一致）。
     */
    @Override
    public Set<String> allowedTypesFor(String purpose) {
        if (purpose == null || purpose.isBlank()) {
            return Set.of();
        }
        return switch (purpose) {
            case "avatar" -> IMAGES;
            case "task_material" -> TASK_MATERIALS;
            case "knowledge_source", "knowledge_doc" -> KNOWLEDGE_DOCS;
            default -> {
                log.warn("purpose={} 未登记 MIME 白名单，暂按「文档或图片」放行。"
                        + "请在 FileScanRepository#allowedTypesFor 登记，并同步接口文档。", purpose);
                yield DOCS_OR_IMAGES;
            }
        };
    }

    @Override
    public void markScanning(long fileId) {
        write(fileId, FileConstant.SCANNING, null, "开始扫描");
    }

    @Override
    public void markReady(long fileId, Map<String, Object> scanResult) {
        write(fileId, FileConstant.READY, scanResult, "扫描通过");
    }

    @Override
    public void markRejected(long fileId, String reasonCode, Map<String, Object> scanResult) {
        write(fileId, FileConstant.REJECTED, scanResult, "扫描未通过");
        log.warn("文件未通过安全扫描：fileId={}, reasonCode={}, reason={}",
                fileId, reasonCode, scanResult.get("reason"));
    }

    @Override
    public void markPending(long fileId, String reasonCode, Map<String, Object> scanResult) {
        // 🔴 保持 scanning，绝不写成 rejected/ready：
        // rejected 会让用户拿着没问题的文件反复重传；ready 等于静默跳过扫描。
        write(fileId, FileConstant.SCANNING, scanResult, "扫描未得出结论");
        log.warn("文件扫描未得出结论，保持 scanning 待重试/人工：fileId={}, reasonCode={}, reason={}",
                fileId, reasonCode, scanResult.get("reason"));
    }

    private void write(long fileId, String status, Map<String, Object> scanResult, String action) {
        Files patch = new Files().setId(fileId).setStatus(status);
        if (scanResult != null) {
            patch.setScanResult(toJson(fileId, scanResult));
        }
        int rows = filesMapper.updateById(patch);
        if (rows == 0) {
            // 🔴 updateById 匹配不到行时返回 0，**不抛异常** —— 不检查就是「结论静默丢失」：
            // 编排器照样返回 READY，FileListener 照样打「扫描通过」，而库里还停在 scanning。
            // 走到这里只可能是行在 load() 之后被删了（数据库故障是抛异常而非返回 0），
            // 重试也无从写起，所以留 ERROR 不抛、不触发 MQ 重试。
            log.error("扫描状态写回失败，影响行数为 0：fileId={}, 目标 status={}, 动作={}（该行已被删除？）",
                    fileId, status, action);
            return;
        }
        log.debug("{}：fileId={}, status={}", action, fileId, status);
    }

    private static String toJson(long fileId, Map<String, Object> scanResult) {
        try {
            return JSON.writeValueAsString(scanResult);
        } catch (JsonProcessingException e) {
            // 序列化失败不该让扫描结论丢掉 —— 至少把原因落库，别再往 json 列写半个对象
            log.error("scan_result 序列化失败，只写入错误标记：fileId={}", fileId, e);
            return "{\"reason_code\":\"scan_result_serialize_failed\"}";
        }
    }

    private static Set<String> union(Set<String> a, Set<String> b) {
        Set<String> all = new LinkedHashSet<>(a);
        all.addAll(b);
        return Set.copyOf(all);
    }
}
