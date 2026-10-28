package com.campusflow.tools.fileUtils;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.hssf.extractor.ExcelExtractor;
import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.xslf.extractor.XSLFExtractor;
import org.apache.poi.xslf.usermodel.XMLSlideShow;
import org.apache.poi.xssf.extractor.XSSFExcelExtractor;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.poi.xwpf.extractor.XWPFWordExtractor;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.imageio.ImageIO;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 抽取文档正文 —— 只为内容审核服务（{@link TextExtractor}）。
 *
 * <p>用工程里<b>已有</b>的解析库，不新开一套：PDF 走 PDFBox，Office 走 POI，
 * 纯文本直接解码。都已在 {@code tools/pom.xml} 里声明，不是为本功能新引的依赖。
 *
 * <h3>支持范围</h3>
 * <ul>
 *   <li>{@code text/*}（txt / md / csv …）—— 直接解码，带 UTF-8 → GBK 兜底；</li>
 *   <li>{@code application/pdf} —— PDFBox，<b>逐页</b>抽，抽够就停；<b>文字层过薄时自动走
 *       OCR 兜底</b>（见 {@link #pdfWithOcr}），扫描件不再绕过审核链；</li>
 *   <li>{@code .docx / .xlsx / .pptx} —— POI ooxml；</li>
 *   <li>{@code application/vnd.ms-excel}（.xls）—— POI 核心。</li>
 * </ul>
 *
 * <p>⚠️ <b>两个「抽不出来」的格式，官方依赖没到位，别误以为抽过了</b>：
 * {@code application/msword}(.doc) 与 {@code application/vnd.ms-powerpoint}(.ppt) 这两兄弟的解析器在
 * {@code poi-scratchpad} 里，而本工程只声明了 {@code poi} + {@code poi-ooxml}。
 * 这里返回 {@code null}（= 跳过内容审核）并打 WARN。<b>想补上就加 poi-scratchpad，
 * 但那会多引入两个老旧二进制格式的解析器（攻击面 + 体积），要掂量。</b>
 *
 * <h3>四条纪律</h3>
 * <ol>
 *   <li><b>🔴 解析不可信文件必须有超时。</b>PDFBox / POI 都可能被构造出的畸形文件拖进长时间循环，
 *       而这跑在 MQ 消费者线程上 —— 挂住就是整条队列停止消费。这里和 {@link ClamAvScanner}
 *       用同一套「线程池 + {@code Future.get(timeout)}」兜底。</li>
 *   <li><b>三重上限，一个都不能少</b>：字节数（进内存之前拦）、页数（只抽前 N 页）、字符数。
 *       缺字节上限 = 一个 2G 的文件能把堆打爆。</li>
 *   <li><b>{@code truncated} 必须如实上报</b>。本项目的内容审核链（腾讯云 TMS）单文件只审前 20 万字符，
 *       所以抽取上限刻意设成比它更大（默认 30 万）—— 这样超长文档一定会走到 TMS 的「截断」分支，
 *       结论是「转人工」而不是「通过」。<b>若把抽取上限设得比 TMS 的预算还小，
 *       尾部内容会在 TMS 的截断判断之前就被这里悄悄截掉，文件会被判成 ready。</b></li>
 *   <li><b>失败要抛 {@link IOException}，不是返回空串。</b>空串会被上层当成「没有可审文本」而放行；
 *       抛异常则走「转人工」。方向必须指向更谨慎。</li>
 * </ol>
 *
 * @see com.campusflow.service.service.IFileScanService 编排契约
 * @see com.campusflow.service.config.FileScanConfig 装配处
 */
public class DocumentTextExtractor implements TextExtractor, AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(DocumentTextExtractor.class);

    /** 抽取字符上限。🔴 必须 &gt; TMS 的送审预算（20 万，见 TencentTmsModerator.MAX_CHUNKS）。 */
    public static final int DEFAULT_MAX_CHARS = 300_000;

    /** 只抽前 N 页。挡住「声明几百万页」的畸形 PDF。 */
    public static final int DEFAULT_MAX_PAGES = 200;

    /** 送解析器之前的字节上限：超了直接判「审不完」，不往内存里塞。 */
    public static final long DEFAULT_MAX_BYTES = 50L * 1024 * 1024;

    /** 单次抽取超时。解析大 PDF 比扫病毒慢，给得比 ClamAV 宽松一点。 */
    public static final long DEFAULT_TIMEOUT_MS = 30_000;

    /**
     * OCR 兜底的触发阈值：PDF 文字层抽出的字符数低于它 → 判定「可能是扫描件」→ 渲页送 OCR。
     * 不能设 0：有些扫描件会带零星可抽字符，阈值为 0 会让「几乎没字」的文件仍然绕过审核。
     */
    public static final int DEFAULT_OCR_MIN_CHARS = 50;

    /**
     * 单个文件最多送 OCR 的页数。OCR 按次计费（有免费额度），且每页一次网络调用 ——
     * 必须有上限。超出页数时 {@code truncated} 如实上报，上层转人工，绝不静默放过。
     */
    public static final int DEFAULT_OCR_MAX_PAGES = 15;

    /** 渲染 DPI。150 是「OCR 够用 + 单页 PNG 通常几百 KB」的平衡点，别拉到 300 —— 内存和体积都翻倍。 */
    private static final float OCR_RENDER_DPI = 150f;

    private static final int DEFAULT_POOL_SIZE = 2;

    private static final AtomicInteger THREAD_SEQ = new AtomicInteger();

    private static final String PDF = "application/pdf";
    private static final String DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    private static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private static final String PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    private static final String XLS = "application/vnd.ms-excel";

    /** 能抽正文的确定性二进制格式（text/* 另行判定）。 */
    private static final Set<String> BINARY_SUPPORTED = Set.of(PDF, DOCX, XLSX, PPTX, XLS);

    /**
     * 工程会放行、但这里抽不出正文的格式 —— 命中时打 WARN，
     * 否则它会表现成「文件扫描通过」，而内容审核那一步其实压根没跑。
     */
    private static final Set<String> KNOWN_UNSUPPORTED =
            Set.of("application/msword", "application/vnd.ms-powerpoint");

    private final int maxChars;
    private final int maxPages;
    private final long maxBytes;
    private final long timeoutMs;
    private final ExecutorService executor;
    /** 可空：null = 未配置 OCR，扫描件仍走「无可审核文本」旧路径（但不判通过 —— 上层记 skipped）。 */
    private final TencentOcrClient ocr;
    private final int ocrMinChars;
    private final int ocrMaxPages;

    public DocumentTextExtractor() {
        this(DEFAULT_MAX_CHARS, DEFAULT_MAX_PAGES, DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS,
                null, DEFAULT_OCR_MIN_CHARS, DEFAULT_OCR_MAX_PAGES);
    }

    /** 兼容旧签名：不启用 OCR 兜底。 */
    public DocumentTextExtractor(int maxChars, int maxPages, long maxBytes, long timeoutMs) {
        this(maxChars, maxPages, maxBytes, timeoutMs, null, DEFAULT_OCR_MIN_CHARS, DEFAULT_OCR_MAX_PAGES);
    }

    public DocumentTextExtractor(int maxChars, int maxPages, long maxBytes, long timeoutMs,
                                 TencentOcrClient ocr, int ocrMinChars, int ocrMaxPages) {
        this.maxChars = maxChars > 0 ? maxChars : DEFAULT_MAX_CHARS;
        this.maxPages = maxPages > 0 ? maxPages : DEFAULT_MAX_PAGES;
        this.maxBytes = maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES;
        this.timeoutMs = timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
        this.ocr = ocr;
        this.ocrMinChars = ocrMinChars > 0 ? ocrMinChars : DEFAULT_OCR_MIN_CHARS;
        this.ocrMaxPages = ocrMaxPages > 0 ? ocrMaxPages : DEFAULT_OCR_MAX_PAGES;

        ThreadFactory factory = r -> {
            Thread t = new Thread(r, "doc-extract-" + THREAD_SEQ.incrementAndGet());
            t.setDaemon(true);
            return t;
        };
        this.executor = Executors.newFixedThreadPool(DEFAULT_POOL_SIZE, factory);
    }

    @Override
    public Extracted extract(InputStream in, String contentType) throws IOException {
        String ct = normalize(contentType);

        if (!isExtractable(ct)) {
            if (KNOWN_UNSUPPORTED.contains(ct)) {
                log.warn("正文抽取不支持 {}（解析器在 poi-scratchpad，本工程未引入）——"
                        + "该文件不会进入内容审核链，只会做 MIME 与病毒扫描。", ct);
            }
            // 图片、压缩包、以及所有没登记的类型：不抽正文。返回 none 而不是抛异常 ——
            // 「这个类型本来就不抽」和「抽取失败了」是两件事，上层对它们的处置不同。
            return Extracted.none();
        }

        Path tmp = Files.createTempFile("cf-scan-", ".tmp");
        try {
            long written = copyLimited(in, tmp, maxBytes);
            if (written < 0) {
                throw new IOException("文件超过正文抽取大小上限 " + maxBytes + " 字节，未做内容审核");
            }
            if (written == 0) {
                return Extracted.of("");
            }

            final Path file = tmp;
            final String type = ct;
            Future<Extracted> future;
            try {
                future = executor.submit((Callable<Extracted>) () -> parse(file, type));
            } catch (RejectedExecutionException e) {
                throw new IOException("正文抽取线程池已满，本次未审核");
            }

            try {
                // OCR 兜底打开时，扫描件会追加「每页一次网络调用」的耗时 —— 在原超时上按页数放宽预算，
                // 否则一份 10 页扫描件会把 30s 的抽取超时吃爆，明明能审完却总走转人工。
                long effectiveTimeout = timeoutMs + (ocr != null ? (long) ocrMaxPages * 2_000L : 0L);
                return future.get(effectiveTimeout, TimeUnit.MILLISECONDS);
            } catch (TimeoutException e) {
                future.cancel(true);
                // ⚠️ 取消是 best-effort：PDFBox/POI 不保证响应中断，那个守护线程可能还会跑一会儿。
                // 但调用方已经拿到结论并释放了 MQ 消费者线程，不会拖住整条队列。
                throw new IOException("正文抽取超时（" + timeoutMs + "ms），文件可能不规范，未完成审核");
            } catch (InterruptedException e) {
                future.cancel(true);
                Thread.currentThread().interrupt();
                throw new IOException("正文抽取被中断", e);
            } catch (ExecutionException e) {
                Throwable cause = e.getCause() == null ? e : e.getCause();
                if (cause instanceof IOException io) {
                    throw io;
                }
                throw new IOException("正文抽取失败：" + cause.getClass().getSimpleName()
                        + ": " + cause.getMessage(), cause);
            }
        } finally {
            try {
                Files.deleteIfExists(tmp);
            } catch (IOException e) {
                log.debug("临时文件清理失败：{}", tmp, e);
            }
        }
    }

    @Override
    public void close() {
        executor.shutdownNow();
    }

    // ------------------------------------------------------------------
    // 分发（只在抽取线程里跑）
    // ------------------------------------------------------------------

    private Extracted parse(Path file, String contentType) throws IOException {
        return switch (contentType) {
            // PDF 单独走 OCR 兜底版：扫描件要在这里被救回来，不能只在文字层上打转
            case PDF -> pdfWithOcr(file);
            case DOCX -> truncate(docx(file));
            case XLSX -> truncate(xlsx(file));
            case PPTX -> truncate(pptx(file));
            case XLS -> truncate(xls(file));
            default -> truncate(decodeAll(file));
        };
    }

    /**
     * PDF：先抽文字层；抽出来的字符数低于阈值（{@code ocrMinChars}）且配置了 OCR 时，
     * 判定为扫描件，逐页渲染成图送 {@link TencentOcrClient} 把文字救回来，再送审核链。
     *
     * <p>⚠️ OCR 页数封顶 {@code ocrMaxPages}：超出的页<b>不静默放过</b>，
     * {@code truncated} 如实置 true，上层走「转人工」—— 与截断语义一致。
     *
     * <p>⚠️ OCR 调用失败（欠费/限流/未开通）会从 {@link TencentOcrClient#recognize} 抛
     * {@link IllegalStateException}，在这里转成 {@link IOException} → 上层
     * {@code extract_failed} → 转人工。方向与全链路一致：失败绝不能伪装成通过。
     */
    private Extracted pdfWithOcr(Path file) throws IOException {
        try (PDDocument doc = Loader.loadPDF(file.toFile())) {
            int total = doc.getNumberOfPages();
            int limit = Math.min(total, maxPages);
            boolean truncated = total > limit;   // 文字层只抽了前 maxPages 页

            PDFTextStripper stripper = new PDFTextStripper();
            StringBuilder sb = new StringBuilder();
            for (int page = 1; page <= limit; page++) {
                stripper.setStartPage(page);
                stripper.setEndPage(page);
                sb.append(stripper.getText(doc)).append('\n');
                if (sb.length() >= maxChars) {
                    break;
                }
            }
            if (total > limit) {
                log.info("PDF 共 {} 页，只抽取前 {} 页送审（上限见 campus-flow.scan.text.max-pages）。", total, limit);
            }

            // ---------- OCR 兜底：文字层太薄 → 当扫描件处理 ----------
            if (ocr != null && sb.length() < ocrMinChars) {
                int ocrLimit = Math.min(total, ocrMaxPages);
                log.info("PDF 文字层仅 {} 字符（< {}），判定为扫描件，OCR 前 {} 页（共 {} 页）。",
                        sb.length(), ocrMinChars, ocrLimit, total);

                PDFRenderer renderer = new PDFRenderer(doc);
                for (int page = 0; page < ocrLimit; page++) {
                    byte[] png = renderPage(renderer, page);
                    String pageText = ocr.recognize(png);
                    sb.append(pageText);
                    if (sb.length() >= maxChars) {
                        truncated = true;   // OCR 文本也到上限了，后面页没审
                        break;
                    }
                }
                if (ocrLimit < total) {
                    log.info("PDF 共 {} 页，OCR 只处理前 {} 页（上限见 campus-flow.scan.text.ocr.max-pages）。",
                            total, ocrLimit);
                    truncated = true;
                }
            }

            return cap(sb.toString(), truncated);
        } catch (IOException e) {
            throw e;
        } catch (IllegalStateException e) {
            // OCR 调用失败（TencentOcrClient 抛出）→ 与解析失败同待遇：转人工，绝不放行
            throw new IOException(e.getMessage(), e);
        } catch (RuntimeException e) {
            throw new IOException("PDF 解析失败：" + e.getClass().getSimpleName() + ": " + e.getMessage(), e);
        }
    }

    /** 单页渲染成 PNG 字节。失败按 RuntimeException 往上抛，由 pdfWithOcr 统一转 IOException。 */
    private static byte[] renderPage(PDFRenderer renderer, int pageIndex) throws IOException {
        BufferedImage image = renderer.renderImageWithDPI(pageIndex, OCR_RENDER_DPI, ImageType.RGB);
        ByteArrayOutputStream out = new ByteArrayOutputStream(256 * 1024);
        if (!ImageIO.write(image, "png", out)) {
            throw new IOException("PNG 编码器不可用，无法渲染 PDF 第 " + (pageIndex + 1) + " 页");
        }
        return out.toByteArray();
    }

    private String docx(Path file) throws IOException {
        try (XWPFDocument doc = new XWPFDocument(Files.newInputStream(file));
             XWPFWordExtractor extractor = new XWPFWordExtractor(doc)) {
            return extractor.getText();
        } catch (IOException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new IOException("docx 解析失败：" + e.getClass().getSimpleName() + ": " + e.getMessage(), e);
        }
    }

    private String xlsx(Path file) throws IOException {
        try (XSSFWorkbook wb = new XSSFWorkbook(Files.newInputStream(file));
             XSSFExcelExtractor extractor = new XSSFExcelExtractor(wb)) {
            return extractor.getText();
        } catch (IOException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new IOException("xlsx 解析失败：" + e.getClass().getSimpleName() + ": " + e.getMessage(), e);
        }
    }

    /** .xls（HSSF）在 poi 核心包里，无需 poi-scratchpad。 */
    private String xls(Path file) throws IOException {
        try (HSSFWorkbook wb = new HSSFWorkbook(Files.newInputStream(file));
             ExcelExtractor extractor = new ExcelExtractor(wb)) {
            return extractor.getText();
        } catch (IOException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new IOException("xls 解析失败：" + e.getClass().getSimpleName() + ": " + e.getMessage(), e);
        }
    }

    private String pptx(Path file) throws IOException {
        try (XMLSlideShow show = new XMLSlideShow(Files.newInputStream(file));
             XSLFExtractor extractor = new XSLFExtractor(show)) {
            return extractor.getText();
        } catch (IOException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new IOException("pptx 解析失败：" + e.getClass().getSimpleName() + ": " + e.getMessage(), e);
        }
    }

    /** text/*：整块解码。有字节上限兜底，不怕大。 */
    private String decodeAll(Path file) throws IOException {
        byte[] bytes = Files.readAllBytes(file);
        return decode(bytes);
    }

    // ------------------------------------------------------------------
    // 小工具
    // ------------------------------------------------------------------

    private static String normalize(String contentType) {
        if (contentType == null) {
            return "";
        }
        String ct = contentType.toLowerCase(Locale.ROOT).trim();
        int semi = ct.indexOf(';');
        return semi >= 0 ? ct.substring(0, semi).trim() : ct;
    }

    private static boolean isExtractable(String ct) {
        return ct.startsWith("text/") || BINARY_SUPPORTED.contains(ct);
    }

    /**
     * 解码纯文本。
     *
     * <p>⚠️ 只按 UTF-8 解会把 GBK 的中文文件解成乱码，而乱码送审核 = 这一层等于没跑
     * （既查不出真违规，还可能被当成随机字符）。这里用「严格解码 + 失败换编码」的办法兜底：
     * UTF-8 严格解不过才试 GBK，两个都不行才退回带替换字符的 UTF-8。
     *
     * <p>（Tika 的 {@code CharsetDetector} 更准，但它在 tika-parsers 里，本模块只引了 tika-core。)
     */
    private static String decode(byte[] bytes) {
        List<Charset> candidates = new ArrayList<>(2);
        candidates.add(StandardCharsets.UTF_8);
        if (Charset.isSupported("GBK")) {
            candidates.add(Charset.forName("GBK"));
        }
        for (Charset cs : candidates) {
            CharsetDecoder decoder = cs.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT);
            try {
                return decoder.decode(ByteBuffer.wrap(bytes)).toString();
            } catch (CharacterCodingException ignored) {
                // 换下一个编码
            }
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    /** 按上限截断，并把「截断过」这件事如实带出去。 */
    private Extracted truncate(String text) {
        if (text == null) {
            return Extracted.none();
        }
        return cap(text, false);
    }

    /** 同 {@link #truncate(String)}，但允许调用方预先注入「已截断/未审完」标记（OCR 页数封顶时用）。 */
    private Extracted cap(String text, boolean alreadyTruncated) {
        if (text.isEmpty()) {
            // 空 ≠ 失败：本类型确实没字（如全图扫描且 OCR 也认不出）。让上层按 skipped 显式记「没审」。
            return Extracted.of("");
        }
        if (text.length() <= maxChars) {
            return alreadyTruncated ? Extracted.truncated(text) : Extracted.of(text);
        }

        int end = maxChars;
        // 🔴 不能把字符劈成一半：emoji / 生僻字在 UTF-16 里占两个 char，
        // 从中间切开会产生孤立代理字符，Base64 送审时服务端解码直接报错，且报错位置与真因对不上。
        if (Character.isLowSurrogate(text.charAt(end))) {
            end--;
        }
        log.warn("正文 {} 字符，超过抽取上限 {}，只抽前 {} 字符送审 —— 上层会因「未审完」转人工。",
                text.length(), maxChars, end);
        return Extracted.truncated(text.substring(0, end));
    }

    /**
     * 把流拷到临时文件，边拷边数，超限立刻返回 -1。
     *
     * <p>为什么要落盘而不是直接进内存：PDFBox 需要随机访问，且 POI 的 OOXML 本质是 zip ——
     * 从 {@code File} 读比从流读稳，也顺便让「字节上限」在读之前就把大文件挡住。
     */
    private static long copyLimited(InputStream in, Path target, long maxBytes) throws IOException {
        long total = 0;
        byte[] buf = new byte[8192];
        try (OutputStream out = Files.newOutputStream(target)) {
            int n;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > maxBytes) {
                    return -1;
                }
                out.write(buf, 0, n);
            }
        }
        return total;
    }
}
