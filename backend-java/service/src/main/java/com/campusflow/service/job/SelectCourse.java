package com.campusflow.service.job;


import com.campusflow.service.entity.po.CourseEnrollments;
import com.campusflow.service.entity.po.SelectionRecord;
import com.campusflow.service.service.IAcademicTermsService;
import com.campusflow.service.service.ICourseEnrollmentsService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.xxl.job.core.context.XxlJobHelper;
import com.xxl.job.core.handler.annotation.XxlJob;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.stream.*;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.*;


@Slf4j
@Component
@RequiredArgsConstructor
public class SelectCourse implements InitializingBean {

    private final StringRedisTemplate stringRedisTemplate;
    private final ObjectMapper objectMapper;
    private final ICourseEnrollmentsService courseEnrollmentsService;


    private final IAcademicTermsService termService;

    private static final String GROUP_NAME = "selection-group";

    private static final int BATCH_SIZE = 200;

    @Override
    public void afterPropertiesSet() {
        ensureGroup(getStreamKey());
    }

    /**
     * 确保 stream key 和消费者组存在。
     * Stream 可能因 FLUSHDB / maxmemory 淘汰而消失（组随之消失），
     * 学期码也可能在启动后变化，所以除了启动时，读取遇到 NOGROUP 时也要现场重建。
     */
    private void ensureGroup(String streamKey) {
        try {
            // XGROUP CREATE 要求 Stream 已存在；抢课前可能还没有任何消息。
            if (!Boolean.TRUE.equals(stringRedisTemplate.hasKey(streamKey))) {
                stringRedisTemplate.opsForStream().add(streamKey, Map.of("_init", "1"));
            }
            try {
                stringRedisTemplate.opsForStream().createGroup(streamKey, ReadOffset.from("0"), GROUP_NAME);
                log.info("消费者组 {} 创建成功，stream={}", GROUP_NAME, streamKey);
            } catch (Exception e) {
                String msg = e.getMessage() == null ? "" : e.getMessage();
                // BUSYGROUP = 组已存在，属正常情况
                if (!msg.contains("BUSYGROUP")) {
                    throw e;
                }
            }
        } catch (Exception e) {
            log.error("创建消费者组失败，stream={}", streamKey, e);
        }
    }

    private String getStreamKey() {
        Map<String, String> termCode = termService.currentTermCode();
        String termCodeStr = termCode.get("termCode");
        return "campusflow:selection:stream:{" + termCodeStr + "}";
    }


    private List<MapRecord<String, Object, Object>> readNewMessages(String streamKey, String offset, String CONSUMER_NAME) {
        try {
            Consumer consumer = Consumer.from(GROUP_NAME, CONSUMER_NAME);
            StreamReadOptions options = StreamReadOptions.empty()
                    .count(BATCH_SIZE)
                    .block(Duration.ofMillis(100)); // 阻塞 100ms
            return stringRedisTemplate.opsForStream().read(consumer, options,
                    StreamOffset.create(streamKey, ReadOffset.from(offset)));
        } catch (Exception e) {
            String msg = e.getMessage() == null ? "" : e.getMessage();
            if (msg.contains("NOGROUP")) {
                // Stream key 或消费者组丢失（FLUSHDB/淘汰/学期码变化），现场重建后重试一次
                log.warn("Stream 或消费者组不存在，尝试重建后重读，stream={}", streamKey);
                ensureGroup(streamKey);
                try {
                    Consumer consumer = Consumer.from(GROUP_NAME, CONSUMER_NAME);
                    StreamReadOptions options = StreamReadOptions.empty()
                            .count(BATCH_SIZE)
                            .block(Duration.ofMillis(100));
                    return stringRedisTemplate.opsForStream().read(consumer, options,
                            StreamOffset.create(streamKey, ReadOffset.from(offset)));
                } catch (Exception ex) {
                    log.error("重建消费者组后读取 Stream 仍失败", ex);
                    return null;
                }
            }
            log.error("读取 Stream 失败", e);
            return null;
        }
    }


    private void processBatch(String streamKey, List<MapRecord<String, Object, Object>> records) {
        List<SelectionRecord> selectionRecords = new ArrayList<>();
        List<RecordId> ackIds = new ArrayList<>();
        List<RecordId> failIds = new ArrayList<>();


        for (MapRecord<String, Object, Object> record : records) {
            try {
                String data = (String) record.getValue().get("data");
                SelectionRecord sr = objectMapper.readValue(data, SelectionRecord.class);
                selectionRecords.add(sr);
                ackIds.add(record.getId());
            } catch (Exception e) {
                log.error("消息解析失败，直接 ACK 避免阻塞，recordId={}", record.getId(), e);
                ackIds.add(record.getId());  // 解析失败也 ACK，防止卡住
            }
        }

        if (selectionRecords.isEmpty()) {
            ackMessages(streamKey, ackIds);
            return;
        }

        Set<Long> offeringIds = new HashSet<>();


        List<CourseEnrollments> selected = selectionRecords.stream().map(selectionRecord -> {
            CourseEnrollments courseEnrollments = new CourseEnrollments();
            offeringIds.add(Long.valueOf(selectionRecord.getOfferingId()))  ;
            courseEnrollments.setUserId(Long.valueOf(selectionRecord.getUserId()));
            courseEnrollments.setOfferingId(Long.valueOf(selectionRecord.getOfferingId()));
            courseEnrollments.setStatus("selected");
            return courseEnrollments;
        }).toList();


        try {
            Map<String, String> termCode = termService.currentTermCode();
            String id = termCode.get("id");
            Long termId = Long.valueOf(id);
            int rows = courseEnrollmentsService.saveBatchAndUpdateEnrolled(selected, termId);
            log.info("选课事务已提交：offeringIds={}, termId={}, 更新人数行数={}", offeringIds, termId, rows);
            ackMessages(streamKey, ackIds);
            log.info("批量落库成功，共 {} 条", selectionRecords.size());
        } catch (Exception e) {
            log.error("批量落库失败，不 ACK，等待重试，共 {} 条", selectionRecords.size(), e);
            // 不 ACK，消息留在 PEL，下次 retryPendingMessages 会处理
        }
    }

    private void ackMessages(String streamKey, List<RecordId> ids) {
        if (ids == null || ids.isEmpty()) return;
        try {
            stringRedisTemplate.opsForStream().acknowledge(streamKey, GROUP_NAME, ids.toArray(new RecordId[0]));
        } catch (Exception e) {
            log.error("ACK 失败", e);
        }
    }


    @XxlJob("selectCourse")
    public void selectCourse() {


        int shardIndex = XxlJobHelper.getShardIndex();
        int shardTotal = XxlJobHelper.getShardTotal();

        String CONSUMER_NAME = "consumer-" + shardIndex;
        String streamKey = getStreamKey();
        List<MapRecord<String, Object, Object>> records = readNewMessages(streamKey, ">", CONSUMER_NAME);
        if (records != null && !records.isEmpty()) {
            processBatch(streamKey, records);
        }

        // ========== 第二步：处理超时未 ACK 的消息（重试） ==========
        retryPendingMessages(streamKey, CONSUMER_NAME);


        log.info("开始执行抢课入库");
    }

    private void retryPendingMessages(String streamKey, String CONSUMER_NAME) {
        try {
            // 查询 PEL 中 pending 的消息（空闲超过 30 秒的）
            PendingMessagesSummary summary = stringRedisTemplate.opsForStream()
                    .pending(streamKey, GROUP_NAME);

            if (summary == null || summary.getTotalPendingMessages() == 0) {
                return;
            }

            PendingMessages pending = stringRedisTemplate.opsForStream().pending(
                    streamKey,
                    GROUP_NAME,
                    Range.unbounded(),              // 所有消息ID
                    100L
            );
            for (PendingMessage pm : pending) {
                // XCLAIM：把消息转给当前消费者
                List<MapRecord<String, Object, Object>> claimed = stringRedisTemplate.opsForStream().claim(
                        streamKey, GROUP_NAME, CONSUMER_NAME,
                        Duration.ofSeconds(30),
                        pm.getId()
                );
                if (claimed != null && !claimed.isEmpty()) {
                    processBatch(streamKey, claimed);
                }
            }
        } catch (Exception e) {
            String msg = e.getMessage() == null ? "" : e.getMessage();
            if (msg.contains("NOGROUP")) {
                log.warn("重试 pending 时发现 Stream 或消费者组不存在，已触发重建，stream={}", streamKey);
                ensureGroup(streamKey);
                return;
            }
            log.error("重试 pending 消息失败", e);
        }
    }
}
