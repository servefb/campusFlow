package com.campusflow.service.entity.vo;

import lombok.Data;

import java.time.OffsetDateTime;

/**
 * {@code GET /health/ready} 的返回体 —— 就绪探针（契约文档 §A.10.2）。
 *
 * <h3>status 的取值</h3>
 * 契约只给了 {@code "ready"} 一种样例，降级值是我们补的：四项 checks 全部 {@code "up"}
 * 才给 {@link #STATUS_READY}，否则 {@link #STATUS_NOT_READY}。
 * 🔴 <b>两个词都是约定</b>，改动前要跟运维/前端对齐。
 *
 * <h3>⚠️ 未就绪时 HTTP 状态码是 503，不只靠这个字段</h3>
 * 契约样例只有 {@code 200 + code:0}，但本工程还有一条「业务错误走 HTTP 200 + body 里的 code」
 * 的既有约定（见 {@code docs/admin-metrics/README.md}）。这里<b>有意打破后者</b>：
 * 健康检查的消费者是机器（K8s 的 {@code httpGet}、nginx 的 {@code health_check}），
 * 它们只看状态码，不解析 body。所以成功 200、未就绪 503，body 两种情况下都是完整的
 * Result 信封 —— 给人看的诊断信息一点没少。
 *
 * <h3>⚠️ checks 只覆盖四条依赖，别把它当"全站健康"</h3>
 * 契约样例的四项是 mysql / object_storage / agent_gateway / fulltext_index，
 * <b>不含 Redis 与 RabbitMQ</b> —— 会话历史走 Redis（TTL 600s）、索引流水线走 RabbitMQ，
 * 这两样挂了 ready 依然可能全绿。要覆盖得先改契约。
 *
 * <h3>⚠️ 每项只给 up/down，不给耗时和失败原因</h3>
 * 这是契约的形状限制：它只能回答「有没有病」，不能回答「病在哪」，定位仍然要看日志。
 * 刻意不往里塞契约没有的字段（例如 {@code elapsed_ms} / {@code error}），
 * 那会让前端和运维按两套形状解析。要看失败原因，实现里打了 WARN 日志。
 *
 * <h3>与 /admin/metrics/knowledge-health 的 fulltext_index 同名不同义</h3>
 * 这里是「全文检索可用性」的 up/down；那里是 {@code indexed_sections} /
 * {@code pending_sections} / {@code last_completed_at} 的数量口径。别混。
 *
 * @see com.campusflow.service.controller.HealthController#ready()
 */
@Data
public class HealthReadyVo {

    /** 四项 checks 全部 up 时取此值。 */
    public static final String STATUS_READY = "ready";

    /** 任一项 down 时取此值（同时 HTTP 状态码为 503）。 */
    public static final String STATUS_NOT_READY = "not_ready";

    /** 总闸，见 {@link #STATUS_READY} / {@link #STATUS_NOT_READY}。 */
    private String status;

    /** 四条依赖的探测结果。 */
    private Checks checks;

    /** 本探测的执行时刻，东八区、精确到秒。 */
    private OffsetDateTime timestamp;

    /** 四条依赖。键名与契约样例逐字一致（snake_case），改成驼峰会让消费者静默取到 undefined。 */
    @Data
    public static class Checks {

        /** 主库连通性：从业务在用的 Hikari 池取一个连接并 {@code Connection#isValid()}。 */
        private String mysql;

        /** 对象存储：{@code MinioClient#bucketExists(默认桶)} —— 顺带验证了桶本身还在。 */
        private String object_storage;

        /**
         * 模型网关：HTTP 探测 AI 服务的 {@code GET /health}，要求 2xx。
         *
         * <p>⚠️ 这条路径的成立依赖 Python 侧的白名单。在此之前
         * {@code JWTAuthMiddleware.WHITELIST} 只有 {@code /login} 与 {@code /register}，
         * 连 {@code /docs} 都要 token，所以最早只能判「连得上」而不能判「健康」。
         * 现在 {@code /health} 已加入白名单 —— 谁要是把它移除，这一项会退化成恒 down，
         * 而另外三项照旧全绿（症状是「就绪检查永远不 ready，但业务一切正常」）。
         */
        private String agent_gateway;

        /**
         * 全文检索：查 {@code information_schema.STATISTICS}，确认 {@code knowledge_sections}
         * 上挂着 {@code idx_knowledge_sections_text_fulltext}。
         *
         * <p>库里没有「是否已建索引」的标记位（那个 FULLTEXT 索引由 MySQL 自动维护、全表都在里面），
         * 所以索引存在性只能问 information_schema。
         */
        private String fulltext_index;
    }
}
