package com.campusflow.service.job;

import com.campusflow.service.service.IFileScanRetryService;
import com.xxl.job.core.context.XxlJobHelper;
import com.xxl.job.core.handler.annotation.XxlJob;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 扫描僵死补偿任务的调度入口（XXL-JOB handler）。
 *
 * <h3>调度中心要怎么配（改代码不生效，这一步必须手工做）</h3>
 *
 * <p>调度中心地址：{@code http://192.168.150.100:8880/xxl-job-admin}，默认账号 {@code admin/123456}。
 * 注意端口是 <b>8880</b>、context-path 是 {@code /xxl-job-admin} —— 都不是官方默认值，别按 8080 找。
 * 执行器侧对应的地址与令牌在 {@code application.yml} 的 {@code xxl.job.*}，两边令牌必须一字不差。</p>
 *
 * <ol>
 *   <li>执行器管理里新增执行器：AppName 填 {@code xxl.job.executor.appname} 的值
 *       （默认 {@code campus-flow-executor}），注册方式选「自动注册」；</li>
 *   <li>任务管理里新增任务：JobHandler 填 <b>{@code fileScanRetryJob}</b>（与下面注解的 value 一字不差），
 *       cron 例如 {@code 0 0/10 * * * ?}（每 10 分钟）。</li>
 *   <li>🔴 <b>路由策略必须选「分片广播」</b>。选成「第一个」/「轮询」的话所有实例都会拿到
 *       {@code shardIndex=0, shardTotal=1}，也就是每个实例都扫全量，
 *       同一条僵死记录会被重复重投（次数白白消耗，还可能同时触发多次扫描）。
 *       分片广播下 {@code shardTotal} 等于在线的执行器实例数，每个实例只扫自己那一段。</li>
 *   <li>阻塞处理策略保持默认的「单机串行」：上一次还没跑完就再触发，会让同一实例并发处理同一批记录。</li>
 * </ol>
 *
 * <h3>为什么这个类这么薄</h3>
 * 它只做「取分片参数 → 交给 service → 回报结果」。查询、筛选、重投的规则都在
 * {@link IFileScanRetryService} 里 —— 那些是能在单测里跑的逻辑，不该和调度框架的上下文耦合。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FileScanRetryJob {

    /** 与调度中心「任务管理」里填的 JobHandler 必须完全一致。 */
    public static final String HANDLER_NAME = "fileScanRetryJob";

    private final IFileScanRetryService fileScanRetryService;

    @XxlJob(HANDLER_NAME)
    public void fileScanRetry() {
        int shardIndex = XxlJobHelper.getShardIndex();
        int shardTotal = XxlJobHelper.getShardTotal();

        // 不在调度上下文里时（本地手工触发、写单测）这两个值都是 -1，
        // 此时退化成单机全量，而不是拿 -1 去做区间计算算出个负数区间。
        if (shardIndex < 0 || shardTotal <= 0) {
            XxlJobHelper.log("未取得分片上下文（shardIndex={}, shardTotal={}），按单机全量处理",
                    shardIndex, shardTotal);
            shardIndex = 0;
            shardTotal = 1;
        }

        try {
            IFileScanRetryService.RetryReport report = fileScanRetryService.retryStale(shardIndex, shardTotal);

            XxlJobHelper.log("分片 {}/{} —— {}", shardIndex, shardTotal, report.describe());

            if (report.requeueFailed() > 0) {
                // 投递失败说明 MQ 本身有问题，这是要人立刻看的，标失败让它触发调度中心的告警。
                // （「等人工跳过」和「超次数跳过」都不标失败：前者是设计的正常出口，
                //   后者已在 service 里逐条 ERROR，每次都告警会被脱敏。）
                XxlJobHelper.handleFail(report.describe());
                return;
            }
            XxlJobHelper.handleSuccess(report.describe());
        } catch (Exception e) {
            // 让调度中心的「调度日志」能看到失败原因，不必去翻应用日志
            log.error("扫描僵死补偿执行失败：分片 {}/{}", shardIndex, shardTotal, e);
            XxlJobHelper.log("执行异常：{}", e.toString());
            XxlJobHelper.handleFail("执行异常：" + e.getMessage());
        }
    }


}
