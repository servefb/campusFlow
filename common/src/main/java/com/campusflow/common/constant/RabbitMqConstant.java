package com.campusflow.common.constant;

public interface RabbitMqConstant {

    /**
     * 文件扫描队列的路由键。
     *
     * <p>注意它<b>不是队列名</b>：真正的队列是 {@link #FILE_SCAN_QUEUE}，
     * 两者靠 {@link #FILE_SCAN_EXCHANGE} 的绑定关联起来。
     */
    String FILE_CAMPUSFLOW_ROUTING_KEY = "campusflowFilekey";

    /**
     * 文件安全扫描队列：上传成功后投递，由 {@code FileListener} 消费。
     *
     * <p>Java 侧自产自销，Python 不参与（入库链路的 MQ 消费者已于 2026-09-20 废弃，
     * 改为 Python 侧的 HTTP 显式入库）。
     */
    String FILE_SCAN_QUEUE = "file.scan.queue";

    /** 文件安全扫描交换机（topic）。 */
    String FILE_SCAN_EXCHANGE = "file.exchange";

    /**
     * @deprecated RAG 入库链路已于 2026-09-20 整体废弃（改为管理员显式调 Python 的
     * {@code POST /knowledge/ingest}），队列与交换机不再声明。保留常量仅为对照历史，
     * 不要再往这两个名字上投递。
     */
    @Deprecated
    String CAMPUSFLOW_QUEUE = "rag.file.queue";

    /** @deprecated 同 {@link #CAMPUSFLOW_QUEUE}。 */
    @Deprecated
    String CAMPUSFLOW_EXCHANGE = "rag.file.exchange";
}
