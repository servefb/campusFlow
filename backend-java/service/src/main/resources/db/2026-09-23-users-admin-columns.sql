-- ============================================================================
-- users 表补管理端字段（2026-09-23）
--
-- ⚠️ 本文件**不可重复执行**（第二次会 Duplicate column name）。
-- 由 tools/apply-admin-console-ddl.sh 先查 information_schema 判断是否已应用。
--
-- status 与 is_active 的**同步规则**（两个字段都保留，因为历史代码只认 is_active）：
--   status='active'   ⇔ is_active=1
--   status='disabled' → is_active=0（停用 / 冻结）
--   status='pending'  → is_active=0（邀请已发、尚未激活）
--   status='locked'   → is_active=0（CAS 令牌注销 / 风控锁定）
-- 写接口只允许改 status，由 service 层同步 is_active —— 两列各改一半必然打架，
-- 所以对外只有 status 这一个入口（见 AdminUsersServiceImpl#applyStatus）。
-- ============================================================================

USE campus_flow;

ALTER TABLE users
  ADD COLUMN status enum('active', 'pending', 'locked', 'disabled') NOT NULL DEFAULT 'active'
    COMMENT '管理端账号状态；与 is_active 同步，见脚本注释' AFTER is_active,
  ADD COLUMN last_login_ip varchar(45) NULL COMMENT '最近一次登录 IP，登录时回写' AFTER last_login_at,
  ADD COLUMN network varchar(32) NULL COMMENT '最近登录网络：内网 / VPN / 校外' AFTER last_login_ip,
  ADD COLUMN identity_note varchar(120) NULL COMMENT '身份核验备注，展示用' AFTER network;

CREATE INDEX idx_users_status ON users(status, role, deleted_at);
