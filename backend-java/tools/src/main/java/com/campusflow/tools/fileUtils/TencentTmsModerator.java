package com.campusflow.tools.fileUtils;

import com.tencentcloudapi.common.Credential;
import com.tencentcloudapi.common.exception.TencentCloudSDKException;
import com.tencentcloudapi.common.profile.ClientProfile;
import com.tencentcloudapi.common.profile.HttpProfile;
import com.tencentcloudapi.tms.v20201229.TmsClient;
import com.tencentcloudapi.tms.v20201229.models.TextModerationRequest;
import com.tencentcloudapi.tms.v20201229.models.TextModerationResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * 腾讯云文本内容安全（TMS）审核器 —— 内容审核链的第 ② 层。
 *
 * <p>它解决的是 {@link KeywordModerator} 和 LLM 都解决不了的那件事：<b>合规留痕</b>。
 * 校园场景要求「判定可追溯、可举证」，而一个自研词库或一次 LLM 调用拿不出有资质的定级结论。
 * TMS 返回 {@code Suggestion}(Pass/Review/Block) + {@code Label} + {@code SubLabel} + {@code Score}，
 * 这套字段可以直接落进 {@code files.scan_result} 当作审核凭据。
 *
 * <p><b>链路位置</b>：敏感词库（离线兜底、零成本）→ <b>本类</b>（合规定级）→ LLM（补语义理由）→ 人工队列。
 *
 * <h3>四个必须知道的契约点</h3>
 * <ol>
 *   <li><b>{@code Content} 必须是 UTF-8 的 Base64，且单次上限 10,000 字符</b>（以 Unicode 计量，
 *       是 Base64 编码<em>之前</em>的字符数）。漏了 Base64 会直接吃 {@code ErrTextContentType}，
 *       超长会吃 {@code ErrTextContentLen}。长文档由 {@link #split} 切片。</li>
 *   <li><b>{@code Suggestion=Review} 不等于违规</b>，它的语义是「建议人工二次确认」。
 *       把它当 rejected 是常见错误 —— 用户会拿着一份没问题的文件被反复拒绝。</li>
 *   <li><b>调用失败绝不可判成通过</b>。限流、欠费、超时、未开通，全部走「转人工」，
 *       让 {@link com.campusflow.service.service.IFileScanService} 保持 {@code scanning} 并重试。</li>
 *   <li><b>命中的关键词是敏感内容</b>，落库和给前端展示前要脱敏，别把违规原文原样回传。</li>
 * </ol>
 *
 * <h3>与 {@link Moderation#moderate} 的返回值约定（⚠️ 有个双语义的坑）</h3>
 * {@link com.campusflow.service.service.IFileScanService} 用 {@code label == "needs_review"} 作为「转人工」的保留字。于是 label 字段
 * 在不同分支下含义不同，实现时必须区分清楚：
 * <ul>
 *   <li>{@code Block} → 返回 TMS 的真实标签（如 {@code Porn}），上层走 {@code rejected}；</li>
 *   <li>{@code Review} / 调用异常 → label 必须回填 {@code needs_review}，
 *       真实标签改放进 reason 里，上层才会走 {@code pending} 保持扫描中。</li>
 * </ul>
 *
 * <h3>线程安全</h3>
 * {@code TmsClient} 内部无共享可变状态，可单例复用（SDK 官方口径）。本类所有字段 final，线程安全。
 *
 * @see com.campusflow.service.service.IFileScanService
 * @see com.campusflow.service.config.ModerationConfig 装配处（有序链在此串起来）
 */
public class TencentTmsModerator implements Moderation {

    private static final Logger log = LoggerFactory.getLogger(TencentTmsModerator.class);

    /** TMS 单次请求上限：10,000 个字符（Unicode 计量，Base64 前的字符数）。 */
    static final int MAX_CHARS_PER_CALL = 10_000;

    /**
     * 单个文件最多送审的切片数 —— 20 片 = 20 万字符。
     * 超出的部分<b>不静默放过</b>：结论按「转人工」处理，理由里写明只审了多少（见 {@link #moderate}）。
     */
    static final int MAX_CHUNKS = 20;

    /** 官方接入文档建议：连接 5s、读 30s。设短一点，别把 MQ 消费者挂死在这上面。 */
    private static final int CONNECT_TIMEOUT_SEC = 5;
    private static final int READ_TIMEOUT_SEC = 30;

    private static final String ENDPOINT = "tms.tencentcloudapi.com";

    /** 转人工的保留字，与 {@link com.campusflow.service.service.IFileScanService} 的约定一致。 */
    private static final String NEEDS_REVIEW = "needs_review";

    private static final int SEV_PASS = 1;
    private static final int SEV_REVIEW = 2;
    private static final int SEV_BLOCK = 3;

    /**
     * 🔴 是否把命中的关键词原文写进日志。<b>默认 false</b>。
     * 打开它只在「合规审计要求留证」的场景下有意义，且日志文件要按敏感数据保护；
     * 平时只记命中数量，避免违规原文在日志里到处流转。
     */
    private static final boolean LOG_KEYWORD_TEXT = false;

    private final TmsClient client;
    private final String bizType;

    /**
     * @param secretId 腾讯云 API 密钥 SecretId
     * @param secretKey 腾讯云 API 密钥 SecretKey
     * @param region   地域，如 {@code ap-guangzhou}
     * @param bizType  控制台配置的审核策略编号；留空则用默认策略（{@code TencentCloudDefault}）
     */
    public TencentTmsModerator(String secretId, String secretKey, String region, String bizType) {
        if (!isConfigured(secretId, secretKey, region)) {
            // 构造即校验：宁可启动时炸，也不要运行到一半才发现没配密钥
            throw new IllegalArgumentException("腾讯云 TMS 配置不完整：secretId / secretKey / region 均为必填");
        }

        Credential credential = new Credential(secretId.trim(), secretKey.trim());

        HttpProfile httpProfile = new HttpProfile();
        httpProfile.setEndpoint(ENDPOINT);
        httpProfile.setConnTimeout(CONNECT_TIMEOUT_SEC);
        httpProfile.setReadTimeout(READ_TIMEOUT_SEC);

        ClientProfile clientProfile = new ClientProfile();
        clientProfile.setHttpProfile(httpProfile);

        this.client = new TmsClient(credential, region.trim(), clientProfile);
        this.bizType = blankToNull(bizType);
    }

    /**
     * 配置是否齐全。装配层用它决定要不要把本层加入审核链。
     *
     * <p>⚠️ <b>未配置时的正确做法是「不注册这个 Bean」，而不是让它返回 Pass</b>。
     * 返回 Pass 等于把「这一层没跑」伪装成「这一层跑过了且通过」，会让 {@code scan_result} 撒谎。
     */
    public static boolean isConfigured(String secretId, String secretKey, String region) {
        return !isBlank(secretId) && !isBlank(secretKey) && !isBlank(region);
    }

    @Override
    public Verdict moderate(String text) {
        if (isBlank(text)) {
            return Verdict.pass("文本为空，无需云审核。");
        }

        int chunkCount = Math.min(chunkCountOf(text), MAX_CHUNKS);
        boolean truncated = text.length() > (long) MAX_CHUNKS * MAX_CHARS_PER_CALL;
        List<String> chunks = split(text, MAX_CHUNKS);

        Outcome worst = null;
        int scanned = 0;
        for (int i = 0; i < chunks.size(); i++) {
            Outcome outcome;
            try {
                outcome = callOnce(chunks.get(i));
            } catch (Exception e) {
                // 🔴 调用失败 = 不可判定，不是「通过」。限流/欠费/超时全走这里 → 转人工。
                return Verdict.reject("medium", NEEDS_REVIEW, failureReason(e, i + 1));
            }
            scanned++;

            if (worst == null || outcome.severity() > worst.severity()) {
                worst = outcome;
            }
            if (outcome.severity() == SEV_BLOCK) {
                // 已定案。剩下没审的切片不必再花钱 —— 结论不会比 Block 更重。
                break;
            }
        }

        if (worst == null) {
            // 理论不可达：chunks 非空。宁可转人工也不返回 Pass。
            return Verdict.reject("medium", NEEDS_REVIEW, "云审核未产生任何结论，转人工复核。");
        }

        if (worst.severity() == SEV_BLOCK) {
            logBlock(worst);
            return Verdict.reject(riskLevelOf(worst), labelOf(worst), blockReason(worst, scanned, chunkCount, truncated));
        }

        if (worst.severity() == SEV_REVIEW) {
            // ⚠️ 注意这里 label 回填 needs_review（保留字），TMS 的真实标签放进 reason。
            return Verdict.reject("medium", NEEDS_REVIEW, reviewReason(worst, scanned, chunkCount, truncated));
        }

        if (truncated) {
            // 只审了前 20 万字符，剩下的没人看过 —— 不能算「通过」。
            return Verdict.reject("medium", NEEDS_REVIEW,
                    "文档超长，仅送审前 " + (MAX_CHUNKS * MAX_CHARS_PER_CALL) + " 字符，剩余部分未审，转人工复核。");
        }

        return Verdict.pass("腾讯云 TMS 未识别到风险（" + scanned + " 个片段）。");
    }

    @Override
    public String engine() {
        return "tencent-tms";
    }

    // ------------------------------------------------------------------
    // 单次调用
    // ------------------------------------------------------------------

    private Outcome callOnce(String chunk) throws TencentCloudSDKException {
        TextModerationRequest request = new TextModerationRequest();
        // 🔴 必须 Base64(UTF-8)：直接塞明文会报 InvalidParameterValue.ErrTextContentType
        request.setContent(Base64.getEncoder().encodeToString(chunk.getBytes(StandardCharsets.UTF_8)));
        request.setSourceLanguage("zh");
        request.setType("TEXT");
        if (bizType != null) {
            request.setBizType(bizType);
        }
        // 说明：接口只收 text，拿不到 fileId，所以没法带 DataId（取值限 [A-Za-z0-9_-@#]，≤64 字符）。
        // 若日后要按文件在 TMS 控制台取数排障，给 Moderation#moderate 加一个 fileId 参数，
        // 这里 setDataId("file_" + fileId + "_" + chunkIndex) 即可。

        TextModerationResponse response = client.TextModeration(request);

        String suggestion = orEmpty(response.getSuggestion());
        int keywordCount = response.getKeywords() == null ? 0 : response.getKeywords().length;

        return new Outcome(
                severityOf(suggestion),
                suggestion,
                orEmpty(response.getLabel()),
                orEmpty(response.getSubLabel()),
                response.getScore(),
                keywordCount);
    }

    private static int severityOf(String suggestion) {
        return switch (suggestion) {
            case "Block" -> SEV_BLOCK;
            case "Review" -> SEV_REVIEW;
            default -> SEV_PASS;   // "Pass" 及任何未知值都按通过 —— 未知值另有兜底见下
        };
    }

    // ------------------------------------------------------------------
    // 结论组装（注意 label 的双语义，见类注释）
    // ------------------------------------------------------------------

    /** Block：label 带 TMS 真实标签，上层走 rejected。 */
    private static String blockReason(Outcome o, int scanned, int total, boolean truncated) {
        StringBuilder sb = new StringBuilder("腾讯云 TMS 判定违规：").append(describe(o));
        sb.append("。已审 ").append(scanned).append("/").append(total).append(" 个片段");
        if (truncated) {
            sb.append("（文档超长，仅审前 ").append(MAX_CHUNKS * MAX_CHARS_PER_CALL).append(" 字符）");
        }
        return sb.append("。").toString();
    }

    /** Review：label 回填 needs_review，真实标签挪进 reason，上层走 pending。 */
    private static String reviewReason(Outcome o, int scanned, int total, boolean truncated) {
        StringBuilder sb = new StringBuilder("腾讯云 TMS 建议人工复核：").append(describe(o));
        sb.append("。已审 ").append(scanned).append("/").append(total).append(" 个片段");
        if (truncated) {
            sb.append("（文档超长，仅审前 ").append(MAX_CHUNKS * MAX_CHARS_PER_CALL).append(" 字符）");
        }
        return sb.append("，转人工队列。").toString();
    }

    /** 拼「标签（置信度，N 个关键词）」——关键词只记数量，不写原文。 */
    private static String describe(Outcome o) {
        StringBuilder sb = new StringBuilder(labelOf(o));
        if (o.score() != null) {
            sb.append("（置信度 ").append(o.score());
            if (o.keywordCount() > 0) {
                sb.append("，命中 ").append(o.keywordCount()).append(" 个关键词");
            }
            sb.append("）");
        } else if (o.keywordCount() > 0) {
            sb.append("（命中 ").append(o.keywordCount()).append(" 个关键词）");
        }
        return sb.toString();
    }

    private static String labelOf(Outcome o) {
        if (isBlank(o.label())) {
            return "tms_flagged";
        }
        return isBlank(o.subLabel()) ? o.label() : o.label() + "/" + o.subLabel();
    }

    /** Score 是 SubLabel 的置信度（0-100），借它把 riskLevel 分档。 */
    private static String riskLevelOf(Outcome o) {
        long score = o.score() == null ? 0L : o.score();
        if (score >= 85) {
            return "high";
        }
        if (score >= 60) {
            return "medium";
        }
        return "low";
    }

    /**
     * 调用异常 → 人话 + 分流日志。
     *
     * <p>这里刻意把错误码分开：<b>限流/超时是暂时性问题</b>，重试就好；
     * <b>没开通/欠费是配置问题</b>，抬到 ERROR —— 否则它会表现成「所有文件都转人工」，
     * 排查时容易一路怀疑到业务代码上去。
     */
    private static String failureReason(Exception e, int chunkNo) {
        String code = "";
        if (e instanceof TencentCloudSDKException sdk) {
            code = orEmpty(sdk.getErrorCode());
        }

        String hint = switch (code) {
            case "RequestLimitExceeded", "InternalError.QueryReqLimited" -> "云审核被限流";
            case "InternalError.ErrTextTimeOut" -> "云审核请求超时";
            case "UnauthorizedOperation.Unauthorized" -> "云审核权限不可用（服务未开通 / 套餐包失效 / 账号欠费）";
            case "InvalidParameterValue.ErrTextContentLen", "InvalidParameter.ErrTextContentLen" -> "送审文本超长";
            case "InvalidParameterValue.ErrFileContent", "InvalidParameterValue.ErrTextContentType" -> "送审文本编码异常";
            default -> "云审核调用失败";
        };

        if ("UnauthorizedOperation.Unauthorized".equals(code)) {
            log.error("腾讯云 TMS 不可用：{}（{}/{}）—— 请检查内容安全服务开通状态与套餐包余量",
                    hint, code, shortMessage(e));
        } else {
            log.warn("腾讯云 TMS 调用失败：{}（{}），第 {} 片，本次转人工。", hint, code, chunkNo, e);
        }
        return hint + "（第 " + chunkNo + " 片" + (code.isEmpty() ? "" : ", " + code) + "），转人工复核。";
    }

    private static void logBlock(Outcome o) {
        if (LOG_KEYWORD_TEXT) {
            log.warn("TMS 判定违规：label={}, subLabel={}, score={}, keywordCount={} —— "
                            + "（已开启原文日志，含敏感内容，仅限服务端排障，勿外传、勿落库）",
                    o.label(), o.subLabel(), o.score(), o.keywordCount());
        } else {
            // 默认路径：不落敏感原文。要定位具体命中了什么，用 TMS 控制台的审核明细按时间检索。
            log.warn("TMS 判定违规：label={}, subLabel={}, score={}, keywordCount={}",
                    o.label(), o.subLabel(), o.score(), o.keywordCount());
        }
    }

    // ------------------------------------------------------------------
    // 切片
    // ------------------------------------------------------------------

    /**
     * 按 {@link #MAX_CHARS_PER_CALL} 切片，最多返回 {@code maxChunks} 片。
     *
     * <p>🔴 <b>不能把代理对（surrogate pair）劈成两半</b>：Java 的 {@code char} 是 UTF-16 码元，
     * emoji 和部分生僻字占两个 char。从中间切开会产生一个孤立的代理字符，Base64 后服务端解码
     * 直接报 {@code InvalidParameterValue.ErrFileContent}，而且报错位置和真实原因对不上，很难查。
     */
    static List<String> split(String text, int maxChunks) {
        List<String> out = new ArrayList<>();
        int length = text.length();
        int start = 0;
        while (start < length && out.size() < maxChunks) {
            int end = Math.min(start + MAX_CHARS_PER_CALL, length);
            if (end < length && Character.isLowSurrogate(text.charAt(end))) {
                end--;   // 切点落在低位代理上 → 往前退一位，把整个字符留给下一片
            }
            out.add(text.substring(start, end));
            start = end;
        }
        return out;
    }

    private static int chunkCountOf(String text) {
        int length = text.length();
        return (length + MAX_CHARS_PER_CALL - 1) / MAX_CHARS_PER_CALL;
    }

    // ------------------------------------------------------------------
    // 小工具
    // ------------------------------------------------------------------

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }

    private static String blankToNull(String s) {
        return isBlank(s) ? null : s.trim();
    }

    private static String shortMessage(Exception e) {
        String m = e.getMessage();
        if (m == null) {
            return e.getClass().getSimpleName();
        }
        return m.length() > 200 ? m.substring(0, 200) + "..." : m;
    }

    /** 一片的审核结论。severity 用于跨片取最严重。 */
    private record Outcome(int severity, String suggestion, String label, String subLabel,
                           Long score, int keywordCount) {
    }
}
