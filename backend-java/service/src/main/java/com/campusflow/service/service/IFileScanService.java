package com.campusflow.service.service;

/**
 * 文件安全扫描编排：MIME 检测 → 病毒扫描 → 内容审核，最后一次性写回
 * {@code files.status} / {@code files.scan_result}。
 *
 * <p>调用方只需要给出一个 {@code fileId}：purpose、原始文件名、声明的 content_type
 * 全部由 {@code FileMetaRepository#load} 从 {@code files} 行里读 ——
 * <b>MySQL 是唯一事实来源</b>，MQ 消息里不要冗余这些字段（副本会漂移，排查时更费劲）。
 *
 * <p>状态迁移只认三条出口，别多开：
 * <ul>
 *   <li>{@link Outcome#READY} —— 全过，写 {@code status=ready}；</li>
 *   <li>{@link Outcome#REJECTED} —— <b>文件确实有问题</b>（MIME 不符 / 命中病毒 / 明确违规），
 *       写 {@code status=rejected}；</li>
 *   <li>{@link Outcome#PENDING} —— <b>不是文件的问题</b>：扫描器不可用、存储取流失败、审核没给出结论、
 *       文档太大没审完。保持 {@code scanning} + 记原因，交给重试或人工队列。</li>
 * </ul>
 *
 * <p>🔴 这三条出口分清楚，是这个模块唯一真正容易做错的地方：把「扫描器挂了」写成 {@code rejected}，
 * 用户会拿着完全没问题的一个文件反复重传；写成 {@code ready} 则等于静默跳过扫描。
 *
 * @see com.campusflow.service.service.impl.FileScanServiceImpl 实现
 */
public interface IFileScanService {

    /**
     * 扫一个文件并写回状态。
     *
     * <p><b>本方法不抛异常</b>：所有失败都被翻译成 {@link Outcome} 里的三种出口之一
     * （只有仓储层/存储层自己炸出未受检异常才会往外冒，那属于基础设施故障，该让 MQ 去重试）。
     *
     * @param fileId {@code files.id}
     * @return 走了哪条出口
     */
    Outcome scan(long fileId);

    /** 三条状态出口 + 一条「无事可做」。 */
    enum Outcome {
        /** 全部通过，已写 {@code ready}。 */
        READY,
        /** 文件有问题，已写 {@code rejected}，需重新上传。 */
        REJECTED,
        /** 没能得出结论，保持 {@code scanning}，等重试/人工。 */
        PENDING,
        /** 没有可做的事（记录不存在或已逻辑删除），未写任何状态。 */
        SKIPPED
    }
}
