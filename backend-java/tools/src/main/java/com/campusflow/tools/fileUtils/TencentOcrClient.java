package com.campusflow.tools.fileUtils;

import com.tencentcloudapi.common.Credential;
import com.tencentcloudapi.common.exception.TencentCloudSDKException;
import com.tencentcloudapi.common.profile.ClientProfile;
import com.tencentcloudapi.common.profile.HttpProfile;
import com.tencentcloudapi.ocr.v20181119.OcrClient;
import com.tencentcloudapi.ocr.v20181119.models.GeneralBasicOCRRequest;
import com.tencentcloudapi.ocr.v20181119.models.GeneralBasicOCRResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Base64;

/**
 * 腾讯云通用印刷体识别（GeneralBasicOCR）客户端 —— 扫描版 PDF 的文字救援通道。
 *
 * <p>它解决的是 {@link DocumentTextExtractor} 解决不了的那件事：扫描件 / 拍照转 PDF
 * <b>没有文字层</b>，PDFBox 一页抽不出一个字，整份文档会以「无可审核文本」的名义
 * 绕过整个内容审核链（skipped → ready）。有了 OCR，这类文件先渲染成图片、识别出文字，
 * 再回到正常的 TMS / LLM 审核链上 —— 堵住「图片马甲」这个缺口。
 *
 * <h3>三个必须知道的契约点</h3>
 * <ol>
 *   <li><b>单张图 Base64 后 ≤ 7MB，且仅支持单图单次调用</b>（官方限制）。多页文档由
 *       调用方（{@code DocumentTextExtractor}）按页渲染、逐页调本类，页数上限也在那边控制。</li>
 *   <li><b>识别失败必须抛异常，绝不返回空串。</b>空串会被上层当成「没有可审文本」而放行，
 *       抛异常则走 {@code needs_review} 转人工 —— 和 {@link TencentTmsModerator} 的失败语义
 *       保持同一个方向：宁可转人工，不可静默放过。</li>
 *   <li><b>与 TMS 复用同一对密钥</b>（同一主账号/子账号开通两个服务即可），配置在
 *       {@code campus-flow.scan.ocr.*}，默认值回落到 TMS 的环境变量，避免同一对密钥在
 *       yml 里写两遍、将来改一处漏一处。</li>
 * </ol>
 *
 * <h3>线程安全</h3>
 * {@code OcrClient} 内部无共享可变状态（SDK 官方口径，与 {@link TencentTmsModerator} 同源），
 * 单例复用。本类所有字段 final，线程安全。
 *
 * @see DocumentTextExtractor OCR 的触发点（正文过短 + PDF）
 * @see TencentTmsModerator 同一套密钥与失败语义
 */
public class TencentOcrClient {

    private static final Logger log = LoggerFactory.getLogger(TencentOcrClient.class);

    /** 官方接入文档建议：连接 5s、读 30s（OCR 识别一张图通常 1~2s，30s 已经很宽）。 */
    private static final int CONNECT_TIMEOUT_SEC = 5;
    private static final int READ_TIMEOUT_SEC = 30;

    private static final String ENDPOINT = "ocr.tencentcloudapi.com";

    /** GeneralBasicOCR 的图片 Base64 上限（官方：7MB）。留 1MB 余量防边界误判。 */
    static final long MAX_IMAGE_BYTES = 6L * 1024 * 1024;

    private final OcrClient client;

    /**
     * @param secretId  腾讯云 API 密钥 SecretId（与 TMS 同一对）
     * @param secretKey 腾讯云 API 密钥 SecretKey
     * @param region    地域，如 {@code ap-guangzhou}
     */
    public TencentOcrClient(String secretId, String secretKey, String region) {
        if (isBlank(secretId) || isBlank(secretKey) || isBlank(region)) {
            throw new IllegalArgumentException("腾讯云 OCR 配置不完整：secretId / secretKey / region 均为必填");
        }

        Credential credential = new Credential(secretId.trim(), secretKey.trim());

        HttpProfile httpProfile = new HttpProfile();
        httpProfile.setEndpoint(ENDPOINT);
        httpProfile.setConnTimeout(CONNECT_TIMEOUT_SEC);
        httpProfile.setReadTimeout(READ_TIMEOUT_SEC);

        ClientProfile clientProfile = new ClientProfile();
        clientProfile.setHttpProfile(httpProfile);

        this.client = new OcrClient(credential, region.trim(), clientProfile);
    }

    /**
     * 识别一张图片里的印刷体文字，按行拼接返回。
     *
     * @param imageBytes 图片原始字节（PNG / JPG 均可）
     * @return 识别出的文字；图中没有任何可识别文字时返回空串（这是「识别成功但确实没字」，
     *         与「调用失败」不同 —— 失败走异常）
     * @throws IllegalStateException 调用失败（限流 / 欠费 / 未开通 / 超时）。刻意用非受检异常，
     *                               让 {@code DocumentTextExtractor} 统一转成 {@code IOException} 走转人工
     */
    public String recognize(byte[] imageBytes) {
        if (imageBytes == null || imageBytes.length == 0) {
            throw new IllegalArgumentException("OCR 输入图片为空");
        }
        if (imageBytes.length > MAX_IMAGE_BYTES) {
            throw new IllegalStateException("OCR 输入图片 " + (imageBytes.length / 1024) + "KB，超过单图上限");
        }

        GeneralBasicOCRRequest request = new GeneralBasicOCRRequest();
        request.setImageBase64(Base64.getEncoder().encodeToString(imageBytes));
        // 语言留 auto：校园材料可能混排中英文，auto 由服务端自适应，不需要我们猜

        try {
            GeneralBasicOCRResponse response = client.GeneralBasicOCR(request);
            com.tencentcloudapi.ocr.v20181119.models.TextDetection[] items = response.getTextDetections();
            if (items == null || items.length == 0) {
                return "";
            }
            StringBuilder sb = new StringBuilder();
            for (com.tencentcloudapi.ocr.v20181119.models.TextDetection item : items) {
                String line = item.getDetectedText();
                if (line != null && !line.isBlank()) {
                    sb.append(line).append('\n');
                }
            }
            return sb.toString();
        } catch (TencentCloudSDKException e) {
            String code = e.getErrorCode() == null ? "" : e.getErrorCode();
            // 与 TencentTmsModerator.failureReason 同一套分流口径：没开通/欠费是配置问题，要醒目
            if ("UnauthorizedOperation.Unauthorized".equals(code) || "FailedOperation.UnOpenError".equals(code)) {
                log.error("腾讯云 OCR 不可用：{}（{}）—— 请检查 OCR 服务开通状态与账号余额", code,
                        e.getMessage() == null ? "" : e.getMessage());
            } else {
                log.warn("腾讯云 OCR 调用失败：{}（{}）", code, e.getMessage(), e);
            }
            throw new IllegalStateException("OCR 调用失败（" + code + "）：" + e.getMessage(), e);
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
