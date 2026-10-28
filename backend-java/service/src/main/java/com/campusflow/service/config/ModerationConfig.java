package com.campusflow.service.config;

import com.campusflow.tools.fileUtils.KeywordModerator;
import com.campusflow.tools.fileUtils.Moderation;
import com.campusflow.tools.fileUtils.TencentImsModerator;
import com.campusflow.tools.fileUtils.TencentTmsModerator;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 内容审核链装配。顺序即优先级，{@link com.campusflow.service.service.impl.FileScanServiceImpl}
 * 会按下标依次调用，遇到第一个不通过的就停下。
 *
 * <pre>
 *   ① KeywordModerator      离线敏感词（零成本、零延迟、可解释）            —— 文本
 *   ② TencentTmsModerator   腾讯云 TMS（合规定级、可留证）  ← 未配置密钥时自动跳过   —— 文本
 *      TencentImsModerator  腾讯云 IMS（图片审核：头像/图片材料）← 未配置时图片转人工 —— 图片
 *   ③ ContentModerationAi   LLM 语义补充（只给理由，不单独决定 Block）      —— 文本
 * </pre>
 *
 * <p>⚠️ <b>文本与图片共用这一条 List</b>：各实现用 {@code supportsText()} /
 * {@code supportsImage()} 声明能力，{@code FileScanServiceImpl} 按文件类型过滤调用。
 * 链内顺序只影响文本审核（图片目前只有 IMS 一层）；遇到第一个不通过的就停下。
 *
 * <p>⚠️ <b>为什么 TMS 未配置时要整层跳过，而不是让它返回 Pass</b>：
 * 返回 Pass 会把「这一层没跑」伪装成「这一层跑过了且通过」，{@code scan_result} 就撒了谎 ——
 * 事后审计看到 {@code moderation.passed = true}，会以为云审核兜过底，实际根本没调用。
 * 跳过则至少让「链上只有两层」这件事是显式的，日志里也有 WARN 留痕。
 *
 * <p>⚠️ 这里<b>故意不把 {@link KeywordModerator} / {@link TencentTmsModerator} 注册成独立的 Bean</b>，
 * 只保留这一个显式的有序 List Bean。原因在 Spring 解析「多值依赖」的顺序：
 * {@code doResolveDependency} 会<b>先</b>走 {@code resolveMultipleBeans()} —— 按<b>元素类型</b>
 * （{@code Moderation}）去收集容器里所有该类型的 Bean；<b>只有收集不到任何元素</b>，
 * 才回落到按 {@code List<Moderation>} 精确查找，从而拿到下面这个手工排好序的 List。
 *
 * <p>所以一旦把三个审核器也注册成 Bean，收集逻辑就会接管：注入的不再是本方法返回的 List，
 * 而是「按 {@code @Order} 排的收集结果」（<b>没打 {@code @Order} 的默认排到最后</b>）。
 * 这条链的顺序<b>就是优先级</b>（遇到第一个不通过的就停），顺序错了<b>不会报任何错</b>，
 * 只会让审核策略悄悄改变 —— 这是最难查的一类问题。保持「只有一个 List Bean」语义唯一。
 */
@Configuration
@Slf4j
public class ModerationConfig {

    /** 逗号分隔的敏感词表。生产环境建议改从数据库或配置中心加载。 */
    @Value("${campus-flow.moderation.keywords:}")
    private String keywords;

    @Value("${campus-flow.moderation.tms.secret-id:}")
    private String tmsSecretId;

    @Value("${campus-flow.moderation.tms.secret-key:}")
    private String tmsSecretKey;

    @Value("${campus-flow.moderation.tms.region:ap-guangzhou}")
    private String tmsRegion;

    @Value("${campus-flow.moderation.tms.biz-type:}")
    private String tmsBizType;

    // ---------- 图片审核（IMS）：密钥默认回落 TMS 的同一对，服务在控制台单独开通 ----------

    @Value("${campus-flow.moderation.ims.secret-id:${campus-flow.moderation.tms.secret-id:}}")
    private String imsSecretId;

    @Value("${campus-flow.moderation.ims.secret-key:${campus-flow.moderation.tms.secret-key:}}")
    private String imsSecretKey;

    @Value("${campus-flow.moderation.ims.region:${campus-flow.moderation.tms.region:ap-guangzhou}}")
    private String imsRegion;

    @Value("${campus-flow.moderation.ims.biz-type:}")
    private String imsBizType;

    @Bean
    public List<Moderation> moderationChain(ChatClient.Builder chatClientBuilder) {
        List<Moderation> chain = new ArrayList<>(3);

        // ① 离线敏感词
        List<String> words = parseKeywords(keywords);
        if (words.isEmpty()) {
            log.warn("未配置 campus-flow.moderation.keywords —— 离线敏感词层不会拦截任何内容。"
                    + "若是有意为之请忽略；否则建议接入学校违规词表。");
        }
        chain.add(new KeywordModerator(words));

        // ② 腾讯云 TMS
        if (TencentTmsModerator.isConfigured(tmsSecretId, tmsSecretKey, tmsRegion)) {
            chain.add(new TencentTmsModerator(tmsSecretId, tmsSecretKey, tmsRegion, tmsBizType));
            log.info("内容审核链已装配腾讯云 TMS：region={}, bizType={}", tmsRegion,
                    tmsBizType == null || tmsBizType.isBlank() ? "(默认策略)" : tmsBizType);
        } else {
            log.warn("未配置腾讯云 TMS 密钥（campus-flow.moderation.tms.*），内容审核链将跳过云审核层。"
                    + "注意这是「这一层没有跑」，不是「这一层通过了」——"
                    + "在需要合规留痕的场景下应补上配置。");
        }

        // ③ LLM 语义补充
        chain.add(new ContentModerationAi(chatClientBuilder));

        // ④ 腾讯云 IMS（图片审核）—— 挂在同一条链上，靠 supportsImage() 参与图片文件的审核，
        //    文本路径会按 supportsText()=false 跳过它。未配置时不注册（「没跑」，不是「通过」）。
        if (TencentImsModerator.isConfigured(imsSecretId, imsSecretKey, imsRegion)) {
            chain.add(new TencentImsModerator(imsSecretId, imsSecretKey, imsRegion, imsBizType));
            log.info("内容审核链已装配腾讯云 IMS（图片审核）：region={}",
                    imsRegion + ", bizType=" + (imsBizType == null || imsBizType.isBlank() ? "(默认策略)" : imsBizType));
        } else {
            log.warn("未配置图片审核密钥（campus-flow.moderation.ims.*，默认回落 moderation.tms.*），"
                    + "图片文件（含头像）将以「未配置图片审核引擎」转人工。");
        }

        log.info("内容审核链装配完成，共 {} 层：{}", chain.size(),
                chain.stream().map(Moderation::engine).toList());
        return chain;
    }

    /** 逗号分隔 → 去空去重。 */
    static List<String> parseKeywords(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        return Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .distinct()
                .toList();
    }
}
