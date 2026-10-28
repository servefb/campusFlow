package com.campusflow.service.listener;

import com.campusflow.common.constant.RabbitMqConstant;
import com.campusflow.service.entity.dto.FileScanMessage;
import com.campusflow.service.service.IFileScanService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * 文件安全扫描的 MQ 消费入口。
 *
 * <p>链路：{@code POST /files/presign}（落 MinIO + 写 {@code status=uploaded}）
 * → 投递 {@code file.scan.queue} → <b>本类</b> → {@link IFileScanService}（MIME → 病毒 → 内容审核）
 * → 写回 {@code files.status} / {@code files.scan_result}。
 *
 * <h3>这里刻意只做三件事</h3>
 * 取 fileId、调编排、把结果记进日志。<b>所有状态判断和写回都在 {@link IFileScanService} 里</b> ——
 * 这个类原来踩的坑正是「业务逻辑散在监听器里」：方法签名收 {@code MultipartFile}
 * （servlet 对象，消息里根本传不过来），和实际投递的载荷对不上，于是永远收不到能处理的东西。
 *
 * <h3>消息体</h3>
 * 见 {@link FileScanMessage} —— 只有一个 {@code fileId}；purpose、原始文件名等
 * 消费时从 {@code files} 行里读（MySQL 是唯一事实来源）。
 *
 * <h3>确认模式</h3>
 * 走 {@code application.yml} 里配的 {@code acknowledge-mode: auto}：
 * 方法正常返回即 ack；抛异常则按 retry 配置重试 3 次，之后因
 * {@code default-requeue-rejected: false} 被丢弃。<b>所以下面的 catch 必须打 ERROR</b> ——
 * 否则这条消息就是「静默消失」。
 *
 * @see IFileScanService 编排契约与三条状态出口
 * @see FileScanMessage 消息体
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FileListener {

    private final IFileScanService fileScanService;

    @RabbitListener(queues = RabbitMqConstant.FILE_SCAN_QUEUE)
    public void fileScanListener(FileScanMessage message) {
        if (message == null || message.getFileId() == null) {
            // 格式对但内容空 —— 重试多少次都一样，直接丢弃并留痕
            log.warn("收到没有 fileId 的扫描消息，已丢弃：{}", message);
            return;
        }

        long fileId = message.getFileId();
        long startedAt = System.currentTimeMillis();

        IFileScanService.Outcome outcome;
        try {
            outcome = fileScanService.scan(fileId);
        } catch (Exception e) {
            // 编排层自身不抛异常，能落到这里的只有基础设施故障（数据库连不上等）。
            // 抛出去让 Spring 的重试生效；重试耗尽后被丢弃，所以这行 ERROR 是唯一的事后线索。
            log.error("文件扫描发生未预期异常：fileId={}，将交给 MQ 重试（yml: max-attempts=3）", fileId, e);
            throw e;
        }

        long cost = System.currentTimeMillis() - startedAt;
        switch (outcome) {
            case READY -> log.info("文件扫描通过：fileId={}, 用时 {}ms", fileId, cost);
            case REJECTED -> log.warn("文件被拒：fileId={}, 用时 {}ms（原因见 scan_result.reason_code）", fileId, cost);
            // 不是文件的问题：扫描器不可用 / 审核转人工 / 文档没审完。保持 scanning，等重试或人工。
            case PENDING -> log.warn("文件扫描未得出结论，保持 scanning：fileId={}, 用时 {}ms（原因见 scan_result.reason_code）",
                    fileId, cost);
            case SKIPPED -> log.info("文件无需扫描（记录不存在或已删除）：fileId={}, 用时 {}ms", fileId, cost);
        }
    }
}
