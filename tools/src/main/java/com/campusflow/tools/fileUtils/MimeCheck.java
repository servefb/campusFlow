package com.campusflow.tools.fileUtils;

import org.apache.tika.Tika;
import org.apache.tika.io.TikaInputStream;

import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * MIME 检测：只信文件头（魔数），不信扩展名。
 *
 * <p>依赖只有 {@code org.apache.tika:tika-core}（检测不需要解析器）。
 * <b>刻意不引 tika-parsers</b>：解析不可信文件是独立的一套攻击面（XXE / zip 炸弹 / 内存放大），
 * 需要时再单独评估。本项目抽正文这件事在 Python 侧做。
 */
public final class MimeCheck {

    private static final Tika TIKA = new Tika();

    /** 等价写法归一：不能让 application/x-pdf 这种别名把用户白拒一次。 */
    private static final Map<String, String> ALIASES = Map.of(
            "application/x-pdf", "application/pdf",
            "image/jpg", "image/jpeg",
            "text/x-markdown", "text/markdown",
            "application/x-zip-compressed", "application/zip",
            "application/msword2", "application/msword");

    /**
     * 只引 tika-core 时，docx / xlsx / pptx 会被统一报成这个「容器类型」——
     * 精确区分要解析 [Content_Types].xml（属于 tika-parsers 的活），我们用 zip 条目名自己判。
     */
    private static final String TIKA_OOXML = "application/x-tika-ooxml";
    private static final String OOXML_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    private static final String OOXML_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private static final String OOXML_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

    private MimeCheck() {
    }

    public record Result(String declared, String detected, boolean matched, String reason) {
    }

    /**
     * @param raw      文件流（MinIO 取到的原始流即可）
     * @param filename 原始文件名；仅用于「魔数无法判定」时的扩展名兜底
     * @param declared 客户端声明的 content_type
     * @param allowed  业务允许的真实类型白名单（如知识库：pdf / msword / docx / txt / markdown）
     */
    public static Result check(InputStream raw, String filename, String declared, Set<String> allowed)
            throws IOException {

        String want = normalize(declared);

        // TikaInputStream 会把内容 spool 起来并支持 mark/reset，
        // 所以 detect 之后这个流还能重头再读一遍（供下面的 zip 细分使用）。
        try (TikaInputStream in = TikaInputStream.get(raw)) {
            String real = normalize(TIKA.detect(in, filename));

            if (TIKA_OOXML.equals(real)) {
                real = refineOoxml(in);
            }

            if (real.isEmpty() || "application/octet-stream".equals(real)) {
                return new Result(want, real, false,
                        "无法识别文件真实类型（既不是已知的文本，也不是已知的二进制格式），已拒绝。");
            }
            if (!allowed.contains(real)) {
                return new Result(want, real, false,
                        "文件真实类型 " + real + " 不在允许范围内。");
            }
            if (!real.equals(want)) {
                // 真实类型合法、但和声明不符：典型的「改名伪装」（.exe 改 .pdf 也走这条，
                // 只是那种情况 real 通常已经不在白名单里，会先被上一条拦下）。
                return new Result(want, real, false,
                        "文件声明的类型（" + want + "）与实际内容（" + real + "）不一致。");
            }
            return new Result(want, real, true, null);
        }
    }

    /**
     * 用 zip 条目名区分 OOXML 三兄弟：docx 有 word/、xlsx 有 xl/、pptx 有 ppt/。
     *
     * <p>读不出条目时（流位置异常 / 不是标准 zip）**退化为容器类型**并让上层按声明的子类型放行，
     * 而不是判失败——这里判失败会把所有 Office 文件误杀。
     * <p>若线上发现这里经常退化，改成把文件先落盘、用 {@code TikaInputStream.get(File)} 再来一遍。
     */
    private static String refineOoxml(TikaInputStream in) throws IOException {
        // Tika 2.x 起 TikaInputStream 直接继承 InputStream，不再有 getInputStream()。
        // 上游 Tika.detect() 内部做过 mark/reset，所以这里流位置仍在开头。
        try (ZipInputStream zis = new ZipInputStream(in)) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                String name = entry.getName();
                if (name.startsWith("word/")) {
                    return OOXML_DOCX;
                }
                if (name.startsWith("xl/")) {
                    return OOXML_XLSX;
                }
                if (name.startsWith("ppt/")) {
                    return OOXML_PPTX;
                }
            }
        } catch (IOException ignored) {
            // 落到退化分支
        }
        return TIKA_OOXML;
    }

    /** 去掉参数（charset 等）、小写、别名归一。 */
    private static String normalize(String mime) {
        if (mime == null) {
            return "";
        }
        String m = mime.toLowerCase(Locale.ROOT).trim();
        int semi = m.indexOf(';');
        if (semi >= 0) {
            m = m.substring(0, semi).trim();
        }
        return ALIASES.getOrDefault(m, m);
    }

    /** 业务侧可直接用的白名单常量。 */
    public static final Set<String> KNOWLEDGE_DOC_ALLOWED = Set.of(
            "application/pdf",
            "application/msword",
            OOXML_DOCX,
            "text/plain",
            "text/markdown");

    public static final Set<String> IMAGE_ALLOWED = Set.of(
            "image/jpeg",
            "image/png");
}
