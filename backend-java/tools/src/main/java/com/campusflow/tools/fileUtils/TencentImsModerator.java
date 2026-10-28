package com.campusflow.tools.fileUtils;

import com.tencentcloudapi.common.Credential;
import com.tencentcloudapi.common.exception.TencentCloudSDKException;
import com.tencentcloudapi.common.profile.ClientProfile;
import com.tencentcloudapi.common.profile.HttpProfile;
import com.tencentcloudapi.ims.v20201229.ImsClient;
import com.tencentcloudapi.ims.v20201229.models.ImageModerationRequest;
import com.tencentcloudapi.ims.v20201229.models.ImageModerationResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Base64;

/**
 * 腾讯云图片内容安全（IMS）审核器 —— 图片文件的内容审核层。
 *
 * <p>它接的是 {@code FileScanServiceImpl} 里原来那条「无可审核文本 → skipped → ready」的
 * 放行通道：头像 / 图片任务材料以前<b>完全不做内容审核</b>（TMS 只收文本，够不着图片），
 * 现在图片文件会渲染成 Base64 送 IMS 定级，结论与 TMS 同形（Suggestion + Label + Score），
 * 一样落 {@code files.scan_result} 当审核凭据。
 *
 * <h3>四个契约点（与 {@link TencentTmsModerator} 逐条对齐）</h3>
 * <ol>
 *   <li><b>图片 Base64 单次 ≤ 5MB</b>（官方限制）。超限<b>不缩图也不硬塞</b>，
 *       直接按「转人工」处理 —— 审核链的方向永远是更谨慎，不做有损变换后再审。</li>
 *   <li><b>{@code Suggestion=Review} ≠ 违规</b>，是「建议人工二次确认」→ label 回填
 *       {@code needs_review} 保留字，真实标签放 reason，上层走 pending。</li>
 *   <li><b>调用失败绝不可判成通过</b>。限流 / 欠费 / 未开通 / 超时 → 转人工。</li>
 *   <li><b>与 TMS / OCR 复用同一对密钥</b>，同一账号在控制台开通图片内容安全即可，
 *       配置默认回落到 TMS 的环境变量。</li>
 * </ol>
 *
 * <p>⚠️ 本类只审图片（{@code supportsText()=false}）：文本文件由 TMS 负责，
 * 把图片也塞给 TMS 是类型错误 —— 编排方按 supports 标志分流，不会发生这种调用。
 *
 * <h3>线程安全</h3>
 * {@code ImsClient} 内部无共享可变状态（SDK 官方口径，与 TMS 同源），单例复用。
 *
 * @see Moderation supportsImage() 的通用契约
 * @see com.campusflow.service.config.ModerationConfig 装配处
 * @see TencentTmsModerator 同一套密钥与结论语义
 */
public class TencentImsModerator implements Moderation {

    private static final Logger log = LoggerFactory.getLogger(TencentImsModerator.class);

    /** IMS 单张图片上限：5MB（官方限制，Base64 前）。 */
    static final int MAX_IMAGE_BYTES = 5 * 1024 * 1024;

    /** 官方接入文档建议：连接 5s、读 30s。 */
    private static final int CONNECT_TIMEOUT_SEC = 5;
    private static final int READ_TIMEOUT_SEC = 30;

    private static final String ENDPOINT = "ims.tencentcloudapi.com";

    /** 转人工的保留字，与 {@link com.campusflow.service.service.IFileScanService} 的约定一致。 */
    private static final String NEEDS_REVIEW = "needs_review";

    private final ImsClient client;
    private final String bizType;

    /**
     * @param secretId 腾讯云 API 密钥 SecretId（与 TMS 同一对）
     * @param secretKey 腾讯云 API 密钥 SecretKey
     * @param region   地域，如 {@code ap-guangzhou}
     * @param bizType  控制台配置的审核策略编号；留空则用默认策略
     */
    public TencentImsModerator(String secretId, String secretKey, String region, String bizType) {
        if (isBlank(secretId) || isBlank(secretKey) || isBlank(region)) {
            throw new IllegalArgumentException("腾讯云 IMS 配置不完整：secretId / secretKey / region 均为必填");
        }

        Credential credential = new Credential(secretId.trim(), secretKey.trim());

        HttpProfile httpProfile = new HttpProfile();
        httpProfile.setEndpoint(ENDPOINT);
        httpProfile.setConnTimeout(CONNECT_TIMEOUT_SEC);
        httpProfile.setReadTimeout(READ_TIMEOUT_SEC);

        ClientProfile clientProfile = new ClientProfile();
        clientProfile.setHttpProfile(httpProfile);

        this.client = new ImsClient(credential, region.trim(), clientProfile);
        this.bizType = isBlank(bizType) ? null : bizType.trim();
    }

    /**
     * 配置是否齐全。装配层用它决定要不要把本层加入审核链。
     */
    public static boolean isConfigured(String secretId, String secretKey, String region) {
        return !isBlank(secretId) && !isBlank(secretKey) && !isBlank(region);
    }

    /** 图片专用审核器，不参与文本审核链（编排方按 supports 标志分流）。 */
    @Override
    public boolean supportsText() {
        return false;
    }

    @Override
    public boolean supportsImage() {
        return true;
    }

    @Override
    public Verdict moderate(String text) {
        // 编排方按 supportsText() 分流后不会走到这里；留一个响亮的失败防未来误用
        throw new UnsupportedOperationException("TencentImsModerator 只审图片，文本请走 TencentTmsModerator");
    }

    @Override
    public Verdict moderateImage(byte[] imageBytes, String contentType) {
        if (imageBytes == null || imageBytes.length == 0) {
            return Verdict.reject("medium", NEEDS_REVIEW, "图片内容为空，无法送审，转人工复核。");
        }
        if (imageBytes.length > MAX_IMAGE_BYTES) {
            // 不缩图、不压缩后再审 —— 有损变换后再定级，等于让审核对象和用户上传的不是同一份东西
            return Verdict.reject("medium", NEEDS_REVIEW,
                    "图片 " + (imageBytes.length / 1024 / 1024) + "MB，超过云审核单图 5MB 上限，转人工复核。");
        }

        ImageModerationRequest request = new ImageModerationRequest();
        request.setFileContent(Base64.getEncoder().encodeToString(imageBytes));
        if (bizType != null) {
            request.setBizType(bizType);
        }

        try {
            ImageModerationResponse response = client.ImageModeration(request);
            String suggestion = orEmpty(response.getSuggestion());

            return switch (suggestion) {
                case "Block" -> {
                    log.warn("IMS 判定图片违规：label={}, subLabel={}, score={}",
                            response.getLabel(), response.getSubLabel(), response.getScore());
                    yield Verdict.reject(riskLevelOf(response.getScore()),
                            labelOf(response.getLabel(), response.getSubLabel()),
                            "腾讯云 IMS 判定图片违规：" + labelOf(response.getLabel(), response.getSubLabel())
                                    + "（置信度 " + response.getScore() + "）。");
                }
                case "Review" -> Verdict.reject("medium", NEEDS_REVIEW,
                        "腾讯云 IMS 建议人工复核：" + labelOf(response.getLabel(), response.getSubLabel())
                                + "，转人工队列。");
                default -> Verdict.pass("腾讯云 IMS 未识别到风险。");
            };
        } catch (TencentCloudSDKException e) {
            String code = orEmpty(e.getErrorCode());
            // 分流口径与 TMS 一致：没开通/欠费是配置问题，抬 ERROR；其余按暂时性失败 WARN
            if ("UnauthorizedOperation.Unauthorized".equals(code) || "FailedOperation.UnOpenError".equals(code)) {
                log.error("腾讯云 IMS 不可用：{}（{}）—— 请检查图片内容安全服务开通状态与套餐包余量",
                        code, shortMessage(e));
            } else {
                log.warn("腾讯云 IMS 调用失败：{}（{}），本次转人工。", code, shortMessage(e), e);
            }
            return Verdict.reject("medium", NEEDS_REVIEW, "图片云审核调用失败（" + code + "），转人工复核。");
        }
    }

    @Override
    public String engine() {
        return "tencent-ims";
    }

    // ------------------------------------------------------------------
    // 小工具
    // ------------------------------------------------------------------

    /** Score 是置信度（0-100），借它把 riskLevel 分档（与 TMS 同一档位）。 */
    private static String riskLevelOf(Long score) {
        long s = score == null ? 0L : score;
        if (s >= 85) {
            return "high";
        }
        if (s >= 60) {
            return "medium";
        }
        return "low";
    }

    private static String labelOf(String label, String subLabel) {
        if (isBlank(label)) {
            return "ims_flagged";
        }
        return isBlank(subLabel) ? label : label + "/" + subLabel;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }

    private static String shortMessage(Exception e) {
        String m = e.getMessage();
        if (m == null) {
            return e.getClass().getSimpleName();
        }
        return m.length() > 200 ? m.substring(0, 200) + "..." : m;
    }
}
