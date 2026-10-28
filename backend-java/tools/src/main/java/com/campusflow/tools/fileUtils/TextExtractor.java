package com.campusflow.tools.fileUtils;

import java.io.IOException;
import java.io.InputStream;

/**
 * 抽正文的能力契约，<b>仅用于内容审核</b>。
 *
 * <p>⚠️ 只抽「审核需要的那部分」，别把整个文件读进内存。图片等拿不到文本的类型返回
 * {@link Extracted#none()}，由编排方跳过内容审核（<b>跳过 ≠ 通过</b>）。
 *
 * <p>⚠️ 契约刻意留在 {@code tools} 层而<u>不是</u>跟着扫描编排器走 {@code service} 层：
 * {@code tools} 只依赖 {@code common}，把契约放到 {@code service} 会让本模块的实现类反向依赖上层，
 * 构成 Maven 循环依赖。这里的位置与 {@link Moderation}（审核契约）、{@link ClamAvScanner}（病毒扫描）、
 * {@link MimeCheck}（MIME 检测）同级 —— 「文件处理能力」的对外形状都在本包。
 */
public interface TextExtractor {

    Extracted extract(InputStream in, String contentType) throws IOException;

    /**
     * @param text      抽到的正文；{@code null} 表示该类型不抽正文（<b>不是失败</b>）
     * @param truncated 是否只抽到了一部分。<b>true 时上层必须走「转人工」</b> ——
     *                  没看过的内容不能算「审过且通过」。
     */
    record Extracted(String text, boolean truncated) {

        public static Extracted none() {
            return new Extracted(null, false);
        }

        public static Extracted of(String text) {
            return new Extracted(text, false);
        }

        public static Extracted truncated(String text) {
            return new Extracted(text, true);
        }
    }
}
