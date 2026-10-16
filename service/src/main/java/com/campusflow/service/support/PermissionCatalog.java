package com.campusflow.service.support;

import java.util.List;
import java.util.Set;

/**
 * 管理端权限目录 —— 权限矩阵的<b>定义源</b>。
 *
 * <h3>为什么目录在代码里、勾选状态在库里</h3>
 * 「有哪些权限」是产品契约，跟着代码走（新增一项权限必须改代码：因为要用它的地方也要改）；
 * 「哪个角色有哪项权限」是运行期数据，跟着库走。两者混在一张表里，就会出现
 * 「库里有一项权限，代码里没人检查」这种查不出来的幽灵授权。
 *
 * <p>⚠️ 新增权限时<b>三处要一起改</b>：
 * <ol>
 *   <li>本目录（key / name / group）；</li>
 *   <li>{@code 2026-09-23-admin-console.sql} 的 {@code role_permissions} 种子（给默认角色授权）；</li>
 *   <li>真正执行该权限校验的业务代码（目前除「编辑矩阵需超管」外，权限位还没接进拦截器 ——
 *       见 {@link #NOT_ENFORCED_YET}）。</li>
 * </ol>
 *
 * @author JIA
 * @since 2026-09-23
 */
public final class PermissionCatalog {

    /**
     * ⚠️ <b>当前权限位只用于展示与授权记录，尚未接入强制校验</b>。
     *
     * <p>诚实地写清楚这一点，比让界面看起来「已经做了最小权限」要安全：
     * 现在能拦住人的只有 {@code AdminGuard}（必须是 {@code users.role='admin'}）
     * 与「编辑矩阵需超管」两条。要把权限位真正变成闸门，需要给 {@code WebConfig} 加一条
     * {@code /admin/**} 的拦截规则并按 path → permission_key 映射校验，属独立改动。
     */
    public static final String NOT_ENFORCED_YET =
            "权限位当前用于授权记录与展示，尚未接入强制校验（见 PermissionCatalog 注释）";

    private PermissionCatalog() {
    }

    /**
     * 一项权限的定义。
     *
     * @param key   权限标识（{@code 模块.对象.动作}，与 {@code audit_logs.action} 的风格一致）
     * @param name  中文名，直接上屏
     * @param group 分组，前端按这个分块渲染
     */
    public record Permission(String key, String name, String group) {
    }

    /** 分组名常量 —— 前端按字符串分组，写错一个字符就会多出一个孤立分组。 */
    public static final String GROUP_KNOWLEDGE = "知识治理";
    public static final String GROUP_REVIEW = "内容审核";
    public static final String GROUP_USER = "用户与权限";
    public static final String GROUP_SYSTEM = "系统与运维";
    public static final String GROUP_DATA = "数据与报表";

    /** 全部权限，顺序即界面顺序（同一分组内不要重排，评审过的顺序是有意的）。 */
    public static final List<Permission> ALL = List.of(
            // 知识治理
            new Permission("knowledge.document.read", "查看知识文档与分类", GROUP_KNOWLEDGE),
            new Permission("knowledge.document.write", "文档编目 / 上传与入库", GROUP_KNOWLEDGE),
            new Permission("knowledge.document.publish", "文档上线与下线", GROUP_KNOWLEDGE),
            new Permission("knowledge.conflict.resolve", "新旧条款冲突处置", GROUP_KNOWLEDGE),
            new Permission("knowledge.job.retry", "重建索引与作业重试", GROUP_KNOWLEDGE),
            // 内容审核
            new Permission("review.queue.read", "查看人工复核队列", GROUP_REVIEW),
            new Permission("review.resolve", "复核处置（通过 / 修正 / 驳回）", GROUP_REVIEW),
            new Permission("review.risk.override", "高风险答案放行", GROUP_REVIEW),
            // 用户与权限
            new Permission("users.read", "查看用户列表与统计", GROUP_USER),
            new Permission("users.write", "调整账号状态（冻结 / 激活）", GROUP_USER),
            new Permission("users.role.assign", "分配与回收管理端角色", GROUP_USER),
            new Permission("roles.matrix.write", "编辑权限矩阵", GROUP_USER),
            // 系统与运维
            new Permission("news.source.manage", "新闻源治理与手动同步", GROUP_SYSTEM),
            new Permission("news.publish", "发布 / 编辑 / 下线新闻", GROUP_SYSTEM),
            new Permission("system.settings.write", "变更系统与 RAG 参数", GROUP_SYSTEM),
            new Permission("system.maintenance", "高危维护（重置向量 / 全量索引）", GROUP_SYSTEM),
            // 数据与报表
            new Permission("audit.read", "查看审计日志", GROUP_DATA),
            new Permission("metrics.read", "查看管理看板指标", GROUP_DATA)
    );

    /** 权限 key 集合，用于校验 PATCH 请求里的 key 是不是有效权限。 */
    public static final Set<String> KEYS = ALL.stream().map(Permission::key).collect(java.util.stream.Collectors.toSet());

    /**
     * 角色默认授权 —— <b>只用于生成 DDL 种子</b>（{@code 2026-09-23-admin-console.sql}）。
     *
     * <p>运行期不读这里：库里改过矩阵之后，代码里的默认值再被读一次就等于「悄悄回滚用户的配置」。
     *
     * @param roleKey 角色标识
     * @return 该角色默认拥有的权限 key 集合；未知角色返回空集合
     */
    public static Set<String> defaultGrants(String roleKey) {
        return switch (roleKey) {
            // 超管：全量
            case "super_admin" -> KEYS;
            // 知识治理管理员：知识库全权 + 只读审计
            case "knowledge_governor" -> Set.of(
                    "knowledge.document.read", "knowledge.document.write", "knowledge.document.publish",
                    "knowledge.conflict.resolve", "knowledge.job.retry", "audit.read");
            // 内容合规审核员：审核闭环 + 风险放行
            case "content_auditor" -> Set.of(
                    "review.queue.read", "review.resolve", "review.risk.override",
                    "knowledge.document.read", "news.source.manage", "news.publish", "audit.read");
            // 院系运营查看者：纯只读
            case "department_viewer" -> Set.of("metrics.read", "users.read", "review.queue.read", "knowledge.document.read");
            default -> Set.of();
        };
    }
}
