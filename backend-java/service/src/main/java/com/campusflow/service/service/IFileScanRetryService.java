package com.campusflow.service.service;

/**
 * 扫描僵死补偿：把卡在 {@code scanning} 太久的记录重新投回扫描队列。
 *
 * <p>解决的是这个问题：上传时投递了 {@code file.scan.queue}，但消息可能在传输中丢了、
 * 消费者实例恰好重启、扫描中被 kill，或者 clamd 当时不可用 —— 文件就永远停在 {@code scanning}，
 * 用户看到「安全扫描中」等到天荒地老，也没有任何重试。见 {@code FileConstant.SCANNING} 的说明。
 *
 * <h3>🔴 三条「不能重投」的规则，比查询本身重要</h3>
 * <ol>
 *   <li><b>等人工的不能重投</b>：{@code needs_review} / {@code content_truncated} 是
 *       {@code FileScanServiceImpl} 主动判的「需要人看」，重投一万次结论也一样，
 *       只会把队列刷满、把次数耗光。</li>
 *   <li><b>要有次数上限</b>：{@code scanner_unavailable} 这类是真的可以重试，
 *       但如果扫描器一直没修，没有上限就是「每 N 分钟重投一次，永不停止」——
 *       日志会被刷爆，真正的故障反而被埋掉。超限后停下并报错，让人来看。</li>
 *   <li><b>先记账再投递</b>：见实现类。顺序反了会出现「投出去了但次数没加」，等于无上限。</li>
 * </ol>
 *
 * <h3>切片</h3>
 * 调用方传 {@code shardIndex / shardTotal}（XXL-JOB 的「分片广播」路由策略会给每个执行器实例
 * 不同的值），实现按 <b>主键区间</b>把僵死集合等分，每个实例只处理属于自己的那一段 ——
 * 这样多个实例之间不会重投同一条记录。
 *
 * @see com.campusflow.service.job.FileScanRetryJob 调度入口
 */
public interface IFileScanRetryService {

    /**
     * 处理本分片的僵死记录。
     *
     * @param shardIndex 当前分片序号，从 0 开始
     * @param shardTotal 分片总数；传 1 表示不切片（单机跑全量）
     * @return 本次处理的统计，用于打日志和回报给调度中心
     */
    RetryReport retryStale(int shardIndex, int shardTotal);

    /**
     * 一次补偿执行的统计。
     *
     * <p>{@code skippedHuman} 和 {@code skippedOverLimit} 分开计数是刻意的：
     * 前者是**正常**的（那些文件本来就在等人），后者是**要人介入**的信号
     * （重试次数已经用完，某些基础设施大概还没好）。混在一起就分不出该不该管。
     */
    record RetryReport(int candidates,
                       int requeued,
                       int skippedHuman,
                       int skippedOverLimit,
                       int requeueFailed) {

        public static RetryReport none() {
            return new RetryReport(0, 0, 0, 0, 0);
        }

        public String describe() {
            return "候选 " + candidates
                    + "，重投 " + requeued
                    + "，等人工跳过 " + skippedHuman
                    + "，超次数跳过 " + skippedOverLimit
                    + "，投递失败 " + requeueFailed;
        }
    }
}
