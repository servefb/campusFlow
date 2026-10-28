package com.campusflow.service.service.impl;

import com.campusflow.service.scan.FileMetaRepository;
import com.campusflow.service.scan.ObjectStorage;
import com.campusflow.service.service.IFileScanService;
import com.campusflow.tools.fileUtils.ClamAvScanner;
import com.campusflow.tools.fileUtils.MimeCheck;
import com.campusflow.tools.fileUtils.Moderation;
import com.campusflow.tools.fileUtils.TextExtractor;

import java.io.IOException;
import java.io.InputStream;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * {@link IFileScanService} 的实现：三段编排的顺序、每条分支的出口选择、以及 {@code scan_result} 的组装。
 *
 * <p>语义约定（三条出口的取舍、为什么「扫描器不可用」不能写成 {@code rejected}）见
 * {@link IFileScanService} 的类注释 —— 那是调用方与实现共同的契约，这里只写怎么做到。
 *
 * <p>装配见 {@code com.campusflow.service.config.FileScanConfig}；MIME 白名单见
 * {@link FileMetaRepository#allowedTypesFor(String)}；状态写回见 {@link FileMetaRepository}。
 */
public class FileScanServiceImpl implements IFileScanService {

    /** 内部约定：Moderation 返回 label = needs_review 表示「没法自动判」，交人工。 */
    private static final String NEEDS_REVIEW = "needs_review";

    /** 图片审核读进内存的字节上限。云端 IMS 单图限 5MB，读 10MB 封顶足够，防大图打爆堆。 */
    private static final int MAX_IMAGE_READ_BYTES = 10 * 1024 * 1024;

    private final FileMetaRepository repo;
    private final ObjectStorage storage;
    private final ClamAvScanner clamAv;
    private final List<Moderation> moderators;
    private final TextExtractor textExtractor;

    public FileScanServiceImpl(FileMetaRepository repo,
                               ObjectStorage storage,
                               ClamAvScanner clamAv,
                               List<Moderation> moderators,
                               TextExtractor textExtractor) {
        this.repo = repo;
        this.storage = storage;
        this.clamAv = clamAv;
        this.moderators = moderators == null ? List.of() : moderators;
        this.textExtractor = textExtractor;
    }

    @Override
    public Outcome scan(long fileId) {
        FileMetaRepository.FileMeta meta = repo.load(fileId);
        if (meta == null) {
            // 记录不存在 / 已逻辑删除。绝不能写状态 —— 那会把一行已删数据复活。
            return Outcome.SKIPPED;
        }

        Map<String, Object> result = new LinkedHashMap<>();
        long startedAt = System.currentTimeMillis();

        // ---------- 前置：白名单 ----------
        Set<String> allowed = repo.allowedTypesFor(meta.purpose());
        if (allowed == null || allowed.isEmpty()) {
            // 🔴 白名单没配 = 我们的配置问题，不是文件的问题。
            // 这里如果判 rejected，会让某个 purpose 下的上传被整批打回，且用户完全不知道为什么。
            result.put("mime", mapOf("declared", nz(meta.declaredContentType()), "detected", "", "matched", false));
            return pending(fileId, "no_whitelist",
                    "purpose=" + nz(meta.purpose()) + " 没有配置允许的 MIME 白名单，无法判定，转人工。",
                    result, startedAt);
        }

        // ---------- 开扫：uploaded → scanning ----------
        repo.markScanning(fileId);

        // ---------- ① MIME 检测 ----------
        MimeCheck.Result mime;
        try (InputStream in = storage.openStream(fileId)) {
            mime = MimeCheck.check(in, meta.originalName(), meta.declaredContentType(), allowed);
        } catch (IOException e) {
            result.put("mime", mapOf("declared", nz(meta.declaredContentType()), "detected", "", "matched", false));
            return pending(fileId, "storage_unavailable", "取文件流失败：" + e.getClass().getSimpleName(), result, startedAt);
        }
        result.put("mime", mapOf(
                "declared", nz(mime.declared()),
                "detected", nz(mime.detected()),
                "matched", mime.matched()));
        if (!mime.matched()) {
            return rejected(fileId, "mime_mismatch", mime.reason(), result, startedAt);
        }

        // ---------- ② 病毒扫描 ----------
        ClamAvScanner.ScanResult virus;
        try (InputStream in = storage.openStream(fileId)) {
            virus = clamAv.scan(in);
        } catch (IOException e) {
            virus = new ClamAvScanner.ScanResult(ClamAvScanner.Verdict.UNAVAILABLE, null,
                    e.getClass().getSimpleName() + ": " + e.getMessage());
        }
        result.put("virus", mapOf(
                "verdict", virus.verdict().name().toLowerCase(),
                "engine", "clamav",
                "signature", nz(virus.signature()),
                "detail", nz(virus.detail())));

        if (virus.verdict() == ClamAvScanner.Verdict.INFECTED) {
            return rejected(fileId, "virus", "检测到恶意文件：" + virus.signature(), result, startedAt);
        }
        if (virus.verdict() == ClamAvScanner.Verdict.UNAVAILABLE) {
            // 🔴 扫描器不可用 —— 绝不写 rejected，也绝不写 ready
            return pending(fileId, "scanner_unavailable", "病毒扫描器不可用：" + virus.detail(), result, startedAt);
        }

        // ---------- ③ 内容审核 ----------
        if (mime.detected().startsWith("image/")) {
            // 图片没有「正文」可抽，文本审核链够不着它 —— 走图片审核专用通道（IMS）。
            // 返回值语义与文本路径完全一致：Block→rejected / needs_review→pending / 全过→继续收口。
            return moderateImage(fileId, mime.detected(), result, startedAt);
        }

        String text = null;
        boolean extractTruncated = false;
        if (textExtractor != null) {
            try (InputStream in = storage.openStream(fileId)) {
                TextExtractor.Extracted extracted = textExtractor.extract(in, mime.detected());
                if (extracted != null) {
                    text = extracted.text();
                    extractTruncated = extracted.truncated();
                }
            } catch (IOException e) {
                // 抽正文失败不阻断：记下来，走「转人工」而不是直接放过
                result.put("moderation", List.of(mapOf(
                        "passed", false, "riskLevel", "medium", "label", NEEDS_REVIEW,
                        "reason", "正文抽取失败：" + e.getClass().getSimpleName(), "engine", "none")));
                return pending(fileId, "extract_failed", "正文抽取失败，转人工复核。", result, startedAt);
            }
        }

        if (text != null && !text.isBlank()) {
            List<Map<String, Object>> steps = new ArrayList<>();
            for (Moderation m : moderators) {
                // 链上可能有图片专用审核器（IMS）—— 文本路径只调声明支持文本的，别把类型搞混
                if (!m.supportsText()) {
                    continue;
                }
                Moderation.Verdict v = m.moderate(text);
                steps.add(mapOf(
                        "engine", m.engine(),
                        "passed", v.passed(),
                        "riskLevel", nz(v.riskLevel()),
                        "label", nz(v.label()),
                        "reason", nz(v.reason())));

                if (!v.passed()) {
                    result.put("moderation", steps);
                    if (NEEDS_REVIEW.equals(v.label())) {
                        // 自动判定给不出结论 → 保持 scanning + 人工队列，别替人做决定
                        return pending(fileId, "needs_review", v.reason(), result, startedAt);
                    }
                    return rejected(fileId, "moderation", v.reason(), result, startedAt);
                }
            }
            result.put("moderation", steps);
        } else {
            // ⚠️ 刻意不写 "passed": true —— 非图片却抽不到文本（如损坏的 PDF）是**没审**，不是「审过且通过」。
            // 图片走上面的 moderateImage 专用通道，不再落到这个分支。
            result.put("moderation", mapOf(
                    "skipped", true,
                    "reason", "无可审核文本（空文本或不支持抽取的格式）。未做内容审核，不等于已通过。"));
        }

        // ---------- 收口：审过的部分都过了，但还有没看过的 ----------
        if (extractTruncated) {
            // 🔴 不能因为「抽出来的那段没问题」就放行 —— 超出的部分根本没进审核链。
            return pending(fileId, "content_truncated",
                    "文档超出单次送审上限，仅审核了抽出的那一段，剩余内容未审，转人工复核。",
                    result, startedAt);
        }

        // ---------- 全过 ----------
        result.put("scanned_at", OffsetDateTime.now().toString());
        result.put("duration_ms", System.currentTimeMillis() - startedAt);
        repo.markReady(fileId, result);
        return Outcome.READY;
    }

    // ---------- 图片审核通道 ----------

    /**
     * 图片文件的内容审核：取原图字节 → 依次调 {@code supportsImage()} 的审核器。
     * 结论语义与文本路径一致；没配任何图片审核器时显式记 skipped（「没审」，不是「通过」）。
     *
     * <p>⚠️ 字节上限 {@value #MAX_IMAGE_READ_BYTES}：超过它不读进内存，直接转人工 ——
     * 云端单图上限才 5MB，更大的图必然超限，没必要先吃 50MB 进堆。
     */
    private Outcome moderateImage(long fileId, String contentType,
                                  Map<String, Object> result, long startedAt) {
        List<Moderation> imageChain = moderators.stream().filter(Moderation::supportsImage).toList();
        if (imageChain.isEmpty()) {
            result.put("moderation", mapOf(
                    "skipped", true,
                    "reason", "未配置图片审核引擎（campus-flow.moderation.ims.*）。图片未做内容审核，不等于已通过。"));
            return pending(fileId, "no_image_moderator",
                    "图片审核引擎未配置，转人工复核。", result, startedAt);
        }

        byte[] image;
        try (InputStream in = storage.openStream(fileId)) {
            image = in.readAllBytes();
        } catch (IOException e) {
            return pending(fileId, "storage_unavailable",
                    "取图片流失败：" + e.getClass().getSimpleName(), result, startedAt);
        }
        if (image.length > MAX_IMAGE_READ_BYTES) {
            return pending(fileId, "needs_review",
                    "图片 " + (image.length / 1024 / 1024) + "MB，超过审核预算，转人工复核。", result, startedAt);
        }

        List<Map<String, Object>> steps = new ArrayList<>();
        for (Moderation m : imageChain) {
            Moderation.Verdict v = m.moderateImage(image, contentType);
            steps.add(mapOf(
                    "engine", m.engine(),
                    "passed", v.passed(),
                    "riskLevel", nz(v.riskLevel()),
                    "label", nz(v.label()),
                    "reason", nz(v.reason())));

            if (!v.passed()) {
                result.put("moderation", steps);
                if (NEEDS_REVIEW.equals(v.label())) {
                    return pending(fileId, "needs_review", v.reason(), result, startedAt);
                }
                return rejected(fileId, "moderation", v.reason(), result, startedAt);
            }
        }
        result.put("moderation", steps);

        result.put("scanned_at", OffsetDateTime.now().toString());
        result.put("duration_ms", System.currentTimeMillis() - startedAt);
        repo.markReady(fileId, result);
        return Outcome.READY;
    }

    // ---------- 三个出口 ----------

    private Outcome rejected(long fileId, String code, String reason, Map<String, Object> result, long startedAt) {
        result.put("reason_code", code);
        result.put("reason", nz(reason));
        result.put("scanned_at", OffsetDateTime.now().toString());
        result.put("duration_ms", System.currentTimeMillis() - startedAt);
        repo.markRejected(fileId, code, result);
        return Outcome.REJECTED;
    }

    private Outcome pending(long fileId, String code, String reason, Map<String, Object> result, long startedAt) {
        result.put("reason_code", code);
        result.put("reason", nz(reason));
        result.put("scanned_at", OffsetDateTime.now().toString());
        result.put("duration_ms", System.currentTimeMillis() - startedAt);
        repo.markPending(fileId, code, result);
        return Outcome.PENDING;
    }

    // ---------- 小工具 ----------

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static Map<String, Object> mapOf(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            m.put(String.valueOf(kv[i]), kv[i + 1]);
        }
        return m;
    }
}
