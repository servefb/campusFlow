package com.campusflow.tools.fileUtils;

/**
 * 内容审核的统一出口。多实现并存、按顺序串起来用：
 *
 * <pre>
 *   ① KeywordModerator      离线敏感词（零成本、可解释、命中即证据）        —— 只审文本
 *   ② TencentTmsModerator   云内容安全-文本（合规定级，可留证）             —— 只审文本
 *      TencentImsModerator  云内容安全-图片（头像 / 图片文件合规定级）      —— 只审图片
 *   ③ ContentModerationAi   LLM 语义补充（只负责给理由，不单独决定 Block）  —— 只审文本
 *   ④ 人工队列              疑似 → 复用 /admin/reviews 工单
 * </pre>
 *
 * <p>⚠️ <b>同一条链同时承担文本审核与图片审核</b>，靠 {@link #supportsText()} /
 * {@link #supportsImage()} 声明能力，编排方（{@code FileScanServiceImpl}）按文件类型过滤：
 * 文本文件只调 {@code supportsText()} 的实现，图片文件只调 {@code supportsImage()} 的实现。
 * 这样「再加一种审核器」只需实现本接口并在装配处插入 List，编排方不用改 —— 这是「通用接口」的意义。
 *
 * <p>⚠️ 一个实现完全可能两种都支持（比如未来的多模态 LLM 审核器），
 * 两个 supports 都返回 true 即可；编排方对同一文件只会按类型调其中一个方法。
 */
public interface Moderation {

    /** 审核结论。 */
    record Verdict(boolean passed, String riskLevel, String label, String reason) {

        public static Verdict pass(String engineReason) {
            return new Verdict(true, "low", null, engineReason);
        }

        public static Verdict reject(String riskLevel, String label, String reason) {
            return new Verdict(false, riskLevel, label, reason);
        }
    }

    /**
     * 文本审核。
     *
     * @return 结论；<b>实现不应抛异常</b>——审核器故障要表达成「转人工」，
     *         让上层保持 scanning 并重试，而不是把文件判死或静默放行。
     */
    Verdict moderate(String text);

    /**
     * 图片审核。仅 {@link #supportsImage()} 为 true 的实现会被以图片方式调用。
     *
     * @param imageBytes  图片原始字节（调用方保证非空；大小上限由各实现按云 API 限制自行把关）
     * @param contentType 内容检出 MIME（如 image/jpeg），供实现区分格式
     * @return 结论；失败语义同 {@link #moderate(String)} —— 表达成「转人工」，不抛异常
     */
    default Verdict moderateImage(byte[] imageBytes, String contentType) {
        throw new UnsupportedOperationException(engine() + " 不支持图片审核");
    }

    /** 是否参与文本审核。图片专用审核器（如 IMS）返回 false，编排方文本路径会跳过它。 */
    default boolean supportsText() {
        return true;
    }

    /** 是否支持图片审核。默认不支持 —— 图片文件会跳过本实现。 */
    default boolean supportsImage() {
        return false;
    }

    /** 引擎标识，写进 scan_result.moderation.engine。 */
    default String engine() {
        return getClass().getSimpleName();
    }
}
