-- ============================================================================
-- 管理后台补齐（2026-09-23）
--
-- 背景：管理端（campusflowadmin）的「用户与角色」「新闻发布」两处接口在后端
-- 一直没有落地，`services/users.ts` 与 `services/settings.ts` 里全是 RESERVED 占位。
-- 本脚本补齐其中**用户与角色**所需的表与字段，以及内容审核工单表。
--
-- ⚠️ 系统设置（/admin/settings*）本轮**不动**，故这里也不建 settings 表。
--
-- 幂等性：DDL 用 IF NOT EXISTS；ALTER 在 MySQL 8.0 里没有 IF NOT EXISTS，
-- 由 tools/apply-admin-console-ddl.sh 先查 information_schema 再决定是否执行。
-- ============================================================================

USE campus_flow;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 1. 管理端角色（RBAC）
--
-- 与 users.role 的关系（**两者并存，语义不同，不要互相顶替**）：
--   · users.role  —— 粗粒度身份枚举（student / teacher / admin），是**登录闸门**
--                    与管理端放行条件（RequireAdmin 判 role === 'admin'）；
--   · roles.role_key / user_roles —— 细粒度**管理端角色**，决定进后台之后能操作哪些板块。
-- 一个 users.role='admin' 的账号可以没有 user_roles 行（能登录后台但无任何治理权限），
-- 反过来 user_roles 里挂了角色而 users.role 仍是 student 时，该账号**登录不了后台** ——
-- 这是有意的：角色是「授权」，登录闸门是「身份」，两件事分开才不会互相越权。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  role_key varchar(64) NOT NULL COMMENT '角色标识，接口里的 role_key',
  name varchar(80) NOT NULL,
  kind varchar(32) NOT NULL DEFAULT '业务角色' COMMENT '系统角色 / 业务角色 / 受限角色',
  description text,
  capabilities json NOT NULL DEFAULT (JSON_ARRAY()) COMMENT '能力摘要，纯展示，不进鉴权判断',
  scope_note varchar(160) COMMENT '授权范围说明',
  is_system boolean NOT NULL DEFAULT false COMMENT '系统内置角色，不允许删除',
  sort_order integer NOT NULL DEFAULT 0,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- ⚠️ 这个唯一键是下面那个 ON DUPLICATE KEY UPDATE 种子的**前提**：
  -- 少写它，种子脚本每跑一次就多插 4 行（2026-09-23 实测踩过），
  -- 而且重复角色不会报任何错，只会在「角色体系」里静静地列出两组同名角色。
  UNIQUE KEY uq_roles_role_key (role_key)
);

-- 角色 × 权限。行存在 = 该角色拥有该权限；allowed=false 表示显式收回（用于覆盖继承）。
CREATE TABLE IF NOT EXISTS role_permissions (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  role_key varchar(64) NOT NULL,
  permission_key varchar(80) NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  updated_by bigint,
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_role_permission (role_key, permission_key)
);

-- 注：role_permissions 上的唯一键 uq_role_permission(role_key, permission_key) 前导列就是
-- role_key，按角色查权限直接命中它，不再另建单列索引（MySQL 的 CREATE INDEX 也没有 IF NOT EXISTS）。

-- 用户 × 管理端角色。
-- ⚠️ 当前管理端 UI 是「一人一角色」（批量分配角色就是覆盖写），所以 user_id 唯一。
-- 将来要做多角色时，去掉 uq_user_role 这个唯一键即可，其它代码不用动。
CREATE TABLE IF NOT EXISTS user_roles (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  user_id bigint NOT NULL,
  role_key varchar(64) NOT NULL,
  granted_by bigint COMMENT '授权人 users.id，用于追溯',
  granted_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_user_role (user_id),
  KEY idx_user_roles_role (role_key)
);

-- ---------------------------------------------------------------------------
-- 2. users 补管理端字段
--
-- ⚠️ 这几列在 2026-09-23-users-admin-columns.sql 里，**不在本文件**。
-- 原因：MySQL 8.0 的 ALTER TABLE 没有 IF NOT EXISTS，放进这个「可反复执行」的脚本里
-- 第二次跑就会报 Duplicate column name。改列的部分单放一个文件，由
-- tools/apply-admin-console-ddl.sh 先查 information_schema 再决定跑不跑。
--
-- 字段与语义：status / last_login_ip / network / identity_note，见那个文件的注释。
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. 内容审核工单（管理端 /admin/reviews*）
--
-- 触发方是**规则引擎**（AI 服务）：回答置信度低、未命中知识源、命中敏感词、
-- 引用已失效法源等场景自动开单。本表只负责「工单」这个事实，不改 messages 表 ——
-- 一条消息可能因为不同原因被多次开单，挂在消息表上会让语义含混。
--
-- ⚠️ 产出端（谁写这张表）在 AI 服务里，本轮只落了表与查询/处置接口。
-- 表里**不预置任何演示数据**：假工单会让「审核队列是空的」看起来像「没有风险」。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_reviews (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  message_id bigint NOT NULL COMMENT '被复核的 assistant 消息 id',
  conversation_id bigint,
  reason varchar(32) NOT NULL COMMENT 'low_confidence / policy_conflict / hallucination / sensitive / stale_citation / security / privacy',
  risk varchar(16) NOT NULL DEFAULT 'medium' COMMENT 'high / medium / low',
  confidence numeric(5, 4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  question text NOT NULL,
  answer text,
  status enum('pending', 'resolved', 'rejected') NOT NULL DEFAULT 'pending',
  action varchar(24) COMMENT 'approve / correct / reject',
  corrected_answer text,
  comment text,
  reviewed_by bigint,
  reviewed_at datetime(3),
  agent_key varchar(80),
  model varchar(80),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_content_reviews_message (message_id),
  KEY idx_content_reviews_queue (status, risk, created_at DESC)
);

-- ---------------------------------------------------------------------------
-- 4. 角色种子数据
--
-- ⚠️ 这四个角色来自管理端原型（`design/semantics.ts` 与页面 mock），
-- 是产品已经画在纸上的四个角色 —— 落库是为了让「角色体系」不再由前端自造，
-- 不是为了造数据。成员数（member_count）由 user_roles 实时聚合，不落库。
-- ---------------------------------------------------------------------------
INSERT INTO roles (role_key, name, kind, description, capabilities, scope_note, is_system, sort_order)
VALUES
  ('super_admin', '超级管理员', '系统角色',
   '全域最高控制权，涵盖智能体总控编排、大模型级切换、密钥管理、安全审计与数据库底层治理。',
   JSON_ARRAY('全部 16 项特权', 'MFA 强制绑定'), '配置角色策略', true, 10),
  ('knowledge_governor', '知识库治理管理员', '业务角色',
   '校园规章、办事指引文档编目、向量快切分配置与知识同步审核。',
   JSON_ARRAY('知识编目 / Diff 审查'), '覆盖教务处与学工处数据', true, 20),
  ('content_auditor', '内容合规审核员', '业务角色',
   '实时干预学生提问敏感词触发、Agent 异常幻觉复核与高风险问答驳回。',
   JSON_ARRAY('工单闭环 / 风险拦截'), '响应 SLA < 5m', true, 30),
  ('department_viewer', '院系运营查看者', '受限角色',
   '仅限查看所属二级学院师生咨询热词、服务调用频度与问题聚类分类。',
   JSON_ARRAY('报表只读权限', '院系级数据隔离'), '院系级数据隔离', true, 40)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), kind = VALUES(kind), description = VALUES(description),
  capabilities = VALUES(capabilities), scope_note = VALUES(scope_note);

-- 现有唯一的管理员账号先落到超管位上，否则「后台席位 0」看着像接口没通。
-- 其它账号一律不分配 —— 席位是要人给的，不预置。
INSERT IGNORE INTO user_roles (user_id, role_key, granted_by)
SELECT id, 'super_admin', NULL FROM users WHERE account = 'admin1001';
