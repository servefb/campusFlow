package com.campusflow.service.config;

import com.campusflow.service.scan.FileScanRepository;
import com.campusflow.service.scan.MinioObjectStorage;
import com.campusflow.service.service.IFileScanService;
import com.campusflow.service.service.impl.FileScanServiceImpl;
import com.campusflow.tools.fileUtils.ClamAvScanner;
import com.campusflow.tools.fileUtils.DocumentTextExtractor;
import com.campusflow.tools.fileUtils.Moderation;
import com.campusflow.tools.fileUtils.TencentOcrClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * 文件扫描链的装配处。
 *
 * <pre>
 *   FileListener（MQ 消费）
 *     └─ IFileScanService / FileScanServiceImpl   三段编排 + 三条状态出口
 *          ├─ FileScanRepository    读 files 行 / 写 status + scan_result
 *          ├─ MinioObjectStorage    按 fileId 取原始流
 *          ├─ ClamAvScanner         病毒扫描      ← ClamAvConfig
 *          ├─ List&lt;Moderation&gt;      内容审核链    ← ModerationConfig
 *          └─ DocumentTextExtractor 正文抽取（只为内容审核服务）
 * </pre>
 *
 * <p>配置项见 {@code application.yml} 的 {@code campus-flow.scan} 段。
 */
@Slf4j
@Configuration
public class FileScanConfig {

    /** 抽取字符上限。🔴 必须大于 TMS 的送审预算（20 万字符），理由见 DocumentTextExtractor 类注释第 3 条。 */
    @Value("${campus-flow.scan.text.max-chars:300000}")
    private int maxChars;

    /** 单个文档最多抽前 N 页。 */
    @Value("${campus-flow.scan.text.max-pages:200}")
    private int maxPages;

    /** 送解析器之前的字节上限，挡住「大文件打爆堆」。 */
    @Value("${campus-flow.scan.text.max-bytes:52428800}")
    private long maxBytes;

    /** 单次正文抽取超时。解析畸形文件可能长时间循环，必须有上限。 */
    @Value("${campus-flow.scan.text.timeout-ms:30000}")
    private long timeoutMs;

    // ---------- OCR 兜底（扫描版 PDF 文字救援） ----------

    /** 与 TMS 复用同一对密钥：默认值直接回落到 TMS 的环境变量，密钥只在一处维护。 */
    @Value("${campus-flow.scan.ocr.secret-id:${campus-flow.moderation.tms.secret-id:}}")
    private String ocrSecretId;

    @Value("${campus-flow.scan.ocr.secret-key:${campus-flow.moderation.tms.secret-key:}}")
    private String ocrSecretKey;

    @Value("${campus-flow.scan.ocr.region:${campus-flow.moderation.tms.region:ap-guangzhou}}")
    private String ocrRegion;

    /** PDF 文字层低于该字符数 → 判定扫描件 → 走 OCR。 */
    @Value("${campus-flow.scan.text.ocr.min-chars:50}")
    private int ocrMinChars;

    /** 单文件最多 OCR 的页数（OCR 按次计费，必须封顶）。 */
    @Value("${campus-flow.scan.text.ocr.max-pages:15}")
    private int ocrMaxPages;

    /**
     * {@code destroyMethod = "close"} 收掉内部线程池，别让解析线程拖住优雅关闭。
     *
     * <p>OCR 密钥没配时返回不带兜底的抽取器（与 TMS「整层跳过并 WARN」同一语义：
     * 是「没跑 OCR」，不是「扫描件已通过审核」）。
     */
    @Bean(destroyMethod = "close")
    public DocumentTextExtractor documentTextExtractor() {
        TencentOcrClient ocr = null;
        if (isOcrConfigured()) {
            ocr = new TencentOcrClient(ocrSecretId, ocrSecretKey, ocrRegion);
            log.info("OCR 兜底已装配：region={}, 文字层 < {} 字符触发, 每文件最多 {} 页",
                    ocrRegion, ocrMinChars, ocrMaxPages);
        } else {
            log.warn("未配置 OCR 密钥（campus-flow.scan.ocr.*，默认回落 moderation.tms.*）—— "
                    + "扫描版 PDF 抽不出文字层时会以「无可审核文本」跳过内容审核。"
                    + "注意这是「没审」，不是「审过且通过」。");
        }
        log.info("正文抽取器已装配：上限 {} 字符 / {} 页 / {} 字节，超时 {}ms",
                maxChars, maxPages, maxBytes, timeoutMs);
        return new DocumentTextExtractor(maxChars, maxPages, maxBytes, timeoutMs,
                ocr, ocrMinChars, ocrMaxPages);
    }

    private boolean isOcrConfigured() {
        return notBlank(ocrSecretId) && notBlank(ocrSecretKey) && notBlank(ocrRegion);
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    /**
     * ⚠️ {@code List<Moderation>} 这个参数依赖 {@link ModerationConfig} 的刻意设计：
     * 那里只注册了<b>一个</b> {@code List<Moderation>} Bean，而没有把每个审核器单独注册成 Bean。
     * 否则容器里会同时存在「三个 Moderation」和「一个 List&lt;Moderation&gt;」，
     * 这个参数到底注入哪个就变得依赖 Spring 的收集规则了。
     *
     * <p>⚠️ 这里用 {@code @Bean} 手工装配、而不是给 {@code FileScanServiceImpl} 打 {@code @Service}，
     * 原因同上：审核链是个显式的有序 List，装配点收敛在这一处比靠容器收集更可控。
     */
    @Bean
    public IFileScanService fileScanService(FileScanRepository fileMetaRepository,
                                            MinioObjectStorage objectStorage,
                                            ClamAvScanner clamAvScanner,
                                            DocumentTextExtractor documentTextExtractor,
                                            List<Moderation> moderationChain) {
        log.info("文件扫描编排已装配：审核链 {} 层", moderationChain.size());
        return new FileScanServiceImpl(fileMetaRepository, objectStorage, clamAvScanner,
                moderationChain, documentTextExtractor);
    }
}
