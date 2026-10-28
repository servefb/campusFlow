-- ============================================================================
-- 权限矩阵种子（2026-09-23）
--
-- ⚠️ 本文件**只能执行一次**（第二次会撞 uq_role_permission 唯一键）。
-- 由 tools/apply-admin-console-ddl.sh 守卫：仅当 role_permissions **一行都没有**时才执行。
--
-- 为什么要有这个守卫、而不是用 INSERT IGNORE：
-- 矩阵是管理员能在界面上改的数据。种子每跑一次就把 allowed 重置回默认值，
-- 等于把人家刚收回的权限悄悄发回去 —— 这种「回滚用户配置」的故障没人会往部署脚本上想。
-- 想把矩阵恢复成出厂设置：`DELETE FROM role_permissions;` 再重跑本脚本。
--
-- 权限清单的**定义源**是 Java 侧的 PermissionCatalog（key / name / group），
-- 这里只负责「默认给谁」，改权限清单必须两边一起改。
-- ============================================================================

USE campus_flow;

INSERT INTO role_permissions (role_key, permission_key, allowed)
SELECT r.role_key,
       p.permission_key,
       CASE
         -- 超级管理员：全量放开
         WHEN r.role_key = 'super_admin' THEN 1

         -- 知识库治理管理员：知识库全权 + 只读审计
         WHEN r.role_key = 'knowledge_governor' AND p.permission_key IN (
           'knowledge.document.read', 'knowledge.document.write', 'knowledge.document.publish',
           'knowledge.conflict.resolve', 'knowledge.job.retry', 'audit.read') THEN 1

         -- 内容合规审核员：审核闭环 + 风险放行 + 新闻治理
         WHEN r.role_key = 'content_auditor' AND p.permission_key IN (
           'review.queue.read', 'review.resolve', 'review.risk.override',
           'knowledge.document.read', 'news.source.manage', 'news.publish', 'audit.read') THEN 1

         -- 院系运营查看者：只读
         WHEN r.role_key = 'department_viewer' AND p.permission_key IN (
           'metrics.read', 'users.read', 'review.queue.read', 'knowledge.document.read') THEN 1

         ELSE 0
       END
FROM roles r
CROSS JOIN (
  SELECT 'knowledge.document.read' AS permission_key
  UNION ALL SELECT 'knowledge.document.write'
  UNION ALL SELECT 'knowledge.document.publish'
  UNION ALL SELECT 'knowledge.conflict.resolve'
  UNION ALL SELECT 'knowledge.job.retry'
  UNION ALL SELECT 'review.queue.read'
  UNION ALL SELECT 'review.resolve'
  UNION ALL SELECT 'review.risk.override'
  UNION ALL SELECT 'users.read'
  UNION ALL SELECT 'users.write'
  UNION ALL SELECT 'users.role.assign'
  UNION ALL SELECT 'roles.matrix.write'
  UNION ALL SELECT 'news.source.manage'
  UNION ALL SELECT 'news.publish'
  UNION ALL SELECT 'system.settings.write'
  UNION ALL SELECT 'system.maintenance'
  UNION ALL SELECT 'audit.read'
  UNION ALL SELECT 'metrics.read'
) p
-- 只给「矩阵里还一行都没有」的角色灌默认值。
-- 用 NOT EXISTS 而不是整表判空：将来新增角色时，它同样能拿到默认授权，
-- 而已经被人工调整过的老角色不会被碰。
WHERE NOT EXISTS (
  SELECT 1 FROM (SELECT DISTINCT role_key FROM role_permissions) x WHERE x.role_key = r.role_key
);
