-- 校园事务智能助手（Campus Flow）数据库初始化脚本
-- 数据库：MySQL 8.0.16+
-- 字符集：utf8mb4；不依赖向量数据库或 AI 数据库扩展

CREATE DATABASE IF NOT EXISTS campus_flow
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE campus_flow;
SET NAMES utf8mb4;
SET time_zone = '+08:00';
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS course_enrollments, course_schedules, course_periods, course_prerequisites,
  course_offerings, courses, academic_terms,
  audit_logs, idempotency_records, knowledge_conflicts,
  knowledge_job_steps, knowledge_jobs, notifications, news_bookmarks,
  campus_news, news_sources, generated_documents, task_events, task_materials,
  task_step_instances, tasks, task_template_requirements, task_template_steps,
  task_templates, message_feedback, message_citations, knowledge_sections,
  knowledge_document_versions, knowledge_documents, knowledge_categories,
  agent_run_steps, agent_runs, message_attachments, messages, conversations,
  agents, files, user_sessions, user_credentials, user_preferences, users,
  organizations;
SET FOREIGN_KEY_CHECKS = 1;

-- 组织机构
CREATE TABLE organizations (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  parent_id bigint,
  code varchar(64) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  short_name varchar(80),
  organization_type varchar(32) NOT NULL DEFAULT 'department',
  contact_phone varchar(32),
  contact_email varchar(254),
  is_active boolean NOT NULL DEFAULT true,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE INDEX idx_organizations_parent ON organizations(parent_id);

-- 用户、凭据、会话和偏好
CREATE TABLE users (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  organization_id bigint,
  account varchar(120) NOT NULL UNIQUE,
  name varchar(80) NOT NULL,
  role enum('student', 'teacher', 'admin') NOT NULL,
  department_name varchar(160),
  student_or_staff_no varchar(64),
  email varchar(254),
  phone_encrypted varbinary(512),
  avatar_file_id bigint,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at datetime(3),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at datetime(3),
  active_student_or_staff_no varchar(64)
    GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN student_or_staff_no ELSE NULL END) STORED
);

CREATE UNIQUE INDEX uq_users_student_or_staff_no
  ON users(active_student_or_staff_no);
CREATE INDEX idx_users_org_role ON users(organization_id, role, deleted_at);

CREATE TABLE user_credentials (
  user_id bigint PRIMARY KEY,
  password_hash text,
  password_algorithm varchar(24) NOT NULL DEFAULT 'argon2id',
  failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until datetime(3),
  password_changed_at datetime(3),
  sso_subject varchar(255) UNIQUE,
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CHECK (password_hash IS NOT NULL OR sso_subject IS NOT NULL)
);

CREATE TABLE user_sessions (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  user_id bigint NOT NULL,
  refresh_token_hash char(64) NOT NULL UNIQUE,
  status enum('active', 'revoked', 'expired') NOT NULL DEFAULT 'active',
  user_agent text,
  ip_address varchar(45),
  expires_at datetime(3) NOT NULL,
  last_used_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at datetime(3)
);

CREATE INDEX idx_user_sessions_active ON user_sessions(user_id, status, expires_at);

CREATE TABLE user_preferences (
  user_id bigint PRIMARY KEY,
  default_agent_mode varchar(32) NOT NULL DEFAULT 'auto',
  answer_length varchar(16) NOT NULL DEFAULT 'balanced' CHECK (answer_length IN ('brief', 'balanced', 'detailed')),
  show_citations boolean NOT NULL DEFAULT true,
  task_notifications boolean NOT NULL DEFAULT true,
  knowledge_notifications boolean NOT NULL DEFAULT true,
  history_retention_days integer CHECK (history_retention_days IS NULL OR history_retention_days BETWEEN 1 AND 3650),
  locale varchar(16) NOT NULL DEFAULT 'zh-CN',
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

-- 私有对象存储文件元数据
CREATE TABLE files (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  owner_id bigint NOT NULL,
  purpose varchar(40) NOT NULL,
  original_name varchar(255) NOT NULL,
  object_key varchar(700) NOT NULL UNIQUE,
  content_type varchar(128) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 char(64),
  status enum('pending', 'uploaded', 'scanning', 'ready', 'rejected', 'deleted') NOT NULL DEFAULT 'pending',
  scan_result json NOT NULL DEFAULT (JSON_OBJECT()),
  uploaded_at datetime(3),
  expires_at datetime(3),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at datetime(3)
);

CREATE INDEX idx_files_owner_status ON files(owner_id, status, created_at DESC, deleted_at);
CREATE INDEX idx_files_sha256 ON files(sha256);

-- Agent 注册表
CREATE TABLE agents (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  agent_key varchar(64) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  description text,
  status enum('online', 'busy', 'degraded', 'offline') NOT NULL DEFAULT 'offline',
  model_name varchar(120),
  model_config json NOT NULL DEFAULT (JSON_OBJECT()),
  supports_attachments boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  last_heartbeat_at datetime(3),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

-- 会话与消息
CREATE TABLE conversations (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  user_id bigint NOT NULL,
  title varchar(240) NOT NULL,
  agent_mode varchar(32) NOT NULL DEFAULT 'auto',
  source varchar(32) NOT NULL DEFAULT 'workspace',
  status enum('active', 'archived', 'deleted') NOT NULL DEFAULT 'active',
  is_bookmarked boolean NOT NULL DEFAULT false,
  last_message_at datetime(3),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at datetime(3)
);

CREATE INDEX idx_conversations_user_recent ON conversations(user_id, last_message_at DESC, deleted_at);
CREATE INDEX idx_conversations_user_status ON conversations(user_id, status, deleted_at);
CREATE FULLTEXT INDEX idx_conversations_title_fulltext ON conversations(title);

CREATE TABLE messages (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  conversation_id bigint NOT NULL,
  parent_message_id bigint,
  role enum('user', 'assistant', 'system', 'tool') NOT NULL,
  status enum('pending', 'streaming', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  content text NOT NULL DEFAULT (''),
  -- 思考过程：模型 reasoning_content 的流式累积，仅 assistant 消息有值（09-16 新增，供对话页/历史回放展示）
  reasoning_content text,
  content_format varchar(16) NOT NULL DEFAULT 'markdown',
  grounded boolean,
  confidence numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  elapsed_ms integer CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
  token_usage json NOT NULL DEFAULT (JSON_OBJECT()),
  error_code varchar(32),
  error_message text,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at datetime(3),
  deleted_at datetime(3)
);

CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at, id, deleted_at);
CREATE INDEX idx_messages_parent ON messages(parent_message_id);

CREATE TABLE message_attachments (
  message_id bigint NOT NULL,
  file_id bigint NOT NULL,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (message_id, file_id)
);

CREATE TABLE agent_runs (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  conversation_id bigint NOT NULL,
  request_message_id bigint NOT NULL,
  response_message_id bigint,
  selected_agent_id bigint,
  status enum('queued', 'running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
  route_reason text,
  started_at datetime(3),
  completed_at datetime(3),
  elapsed_ms integer CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
  error_code varchar(32),
  error_message text,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE INDEX idx_agent_runs_conversation ON agent_runs(conversation_id, created_at DESC);
CREATE INDEX idx_agent_runs_status ON agent_runs(status, created_at);

CREATE TABLE agent_run_steps (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  run_id bigint NOT NULL,
  agent_id bigint,
  step_order smallint NOT NULL CHECK (step_order > 0),
  step_key varchar(64) NOT NULL,
  label varchar(160) NOT NULL,
  status enum('queued', 'running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
  input_summary text,
  output_summary text,
  elapsed_ms integer CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
  started_at datetime(3),
  completed_at datetime(3),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE (run_id, step_order)
);

-- 知识库分类、文档、版本和正文切片
CREATE TABLE knowledge_categories (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  parent_id bigint,
  code varchar(64) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE knowledge_documents (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  category_id bigint,
  issuer_organization_id bigint,
  title text NOT NULL,
  document_no varchar(120),
  issuer_level varchar(32) NOT NULL DEFAULT 'school',
  validity enum('current', 'revised', 'deprecated', 'archive') NOT NULL DEFAULT 'current',
  visibility enum('public', 'campus', 'student', 'teacher', 'department', 'admin') NOT NULL DEFAULT 'campus',
  status enum('draft', 'processing', 'ready', 'failed', 'offline', 'archived') NOT NULL DEFAULT 'draft',
  summary text,
  published_at datetime(3),
  effective_from date,
  effective_to date,
  reference_count bigint NOT NULL DEFAULT 0 CHECK (reference_count >= 0),
  created_by bigint,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at datetime(3),
  active_document_no varchar(120)
    GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN document_no ELSE NULL END) STORED,
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX uq_knowledge_documents_no
  ON knowledge_documents(active_document_no);
CREATE INDEX idx_knowledge_documents_filter ON knowledge_documents(category_id, validity, status, published_at DESC, deleted_at);
CREATE INDEX idx_knowledge_documents_issuer ON knowledge_documents(issuer_organization_id, status, deleted_at);
CREATE FULLTEXT INDEX idx_knowledge_documents_title_fulltext ON knowledge_documents(title);
CREATE INDEX idx_knowledge_documents_no ON knowledge_documents(document_no);

CREATE TABLE knowledge_document_versions (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  document_id bigint NOT NULL,
  source_file_id bigint NOT NULL,
  version_no varchar(48) NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  status enum('draft', 'processing', 'ready', 'failed', 'offline', 'archived') NOT NULL DEFAULT 'processing',
  signature_algorithm varchar(32),
  signature_digest varchar(256),
  signature_verified boolean NOT NULL DEFAULT false,
  signature_verified_at datetime(3),
  page_count integer CHECK (page_count IS NULL OR page_count > 0),
  parser_name varchar(80),
  chunk_count integer NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  metadata json NOT NULL DEFAULT (JSON_OBJECT()),
  created_by bigint,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  current_document_id bigint
    GENERATED ALWAYS AS (CASE WHEN is_current THEN document_id ELSE NULL END) STORED,
  UNIQUE (document_id, version_no)
);

CREATE UNIQUE INDEX uq_knowledge_current_version ON knowledge_document_versions(current_document_id);
CREATE INDEX idx_knowledge_versions_status ON knowledge_document_versions(status, created_at DESC);

CREATE TABLE knowledge_sections (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  version_id bigint NOT NULL,
  parent_section_id bigint,
  chapter_no integer,
  article_no integer,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  heading text,
  section_label varchar(160),
  content text NOT NULL,
  page_start integer,
  page_end integer,
  token_count integer CHECK (token_count IS NULL OR token_count >= 0),
  metadata json NOT NULL DEFAULT (JSON_OBJECT()),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE (version_id, chunk_index),
  CHECK (page_end IS NULL OR page_start IS NULL OR page_end >= page_start)
);

CREATE INDEX idx_knowledge_sections_version_chapter ON knowledge_sections(version_id, chapter_no, article_no, chunk_index);
CREATE FULLTEXT INDEX idx_knowledge_sections_text_fulltext ON knowledge_sections(heading, content);

-- 回答引用和用户评价
CREATE TABLE message_citations (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  message_id bigint NOT NULL,
  document_id bigint NOT NULL,
  version_id bigint NOT NULL,
  section_id bigint NOT NULL,
  citation_order smallint NOT NULL CHECK (citation_order > 0),
  excerpt text NOT NULL,
  similarity numeric(6,5) CHECK (similarity IS NULL OR similarity BETWEEN 0 AND 1),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE (message_id, citation_order),
  UNIQUE (message_id, section_id)
);

CREATE INDEX idx_message_citations_document ON message_citations(document_id, created_at DESC);

CREATE TABLE message_feedback (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  message_id bigint NOT NULL,
  user_id bigint NOT NULL,
  rating enum('helpful', 'not_helpful') NOT NULL,
  reason varchar(500),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE (message_id, user_id)
);

-- 任务模板
CREATE TABLE task_templates (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  template_key varchar(80) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  responsible_organization_id bigint,
  description text,
  form_schema json NOT NULL DEFAULT (JSON_OBJECT()),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE task_template_steps (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  template_id bigint NOT NULL,
  step_order smallint NOT NULL CHECK (step_order > 0),
  name varchar(160) NOT NULL,
  organization_id bigint,
  expected_minutes integer CHECK (expected_minutes IS NULL OR expected_minutes >= 0),
  requires_user_action boolean NOT NULL DEFAULT false,
  config json NOT NULL DEFAULT (JSON_OBJECT()),
  UNIQUE (template_id, step_order)
);

CREATE TABLE task_template_requirements (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  template_id bigint NOT NULL,
  requirement_key varchar(80) NOT NULL,
  name varchar(180) NOT NULL,
  description text,
  allowed_content_types json NOT NULL DEFAULT (JSON_ARRAY()),
  max_size_bytes bigint CHECK (max_size_bytes IS NULL OR max_size_bytes > 0),
  is_required boolean NOT NULL DEFAULT true,
  validation_rule json NOT NULL DEFAULT (JSON_OBJECT()),
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (template_id, requirement_key)
);

-- 任务实例、步骤、材料和事件
CREATE TABLE tasks (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  task_no varchar(32) NOT NULL UNIQUE,
  user_id bigint NOT NULL,
  template_id bigint,
  source_conversation_id bigint,
  source_message_id bigint,
  title varchar(240) NOT NULL,
  status enum('draft', 'in_progress', 'material_required', 'under_review', 'completed', 'cancelled') NOT NULL DEFAULT 'draft',
  responsible_organization_id bigint,
  current_step_order smallint,
  form_data json NOT NULL DEFAULT (JSON_OBJECT()),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  submitted_at datetime(3),
  completed_at datetime(3),
  cancelled_at datetime(3),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at datetime(3)
);

CREATE INDEX idx_tasks_user_status ON tasks(user_id, status, updated_at DESC, deleted_at);
CREATE INDEX idx_tasks_org_status ON tasks(responsible_organization_id, status, updated_at, deleted_at);
CREATE FULLTEXT INDEX idx_tasks_title_fulltext ON tasks(title);

CREATE TABLE task_step_instances (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  task_id bigint NOT NULL,
  template_step_id bigint,
  step_order smallint NOT NULL CHECK (step_order > 0),
  name varchar(160) NOT NULL,
  status enum('pending', 'active', 'completed', 'rejected', 'skipped') NOT NULL DEFAULT 'pending',
  organization_id bigint,
  assignee_user_id bigint,
  result json NOT NULL DEFAULT (JSON_OBJECT()),
  rejection_reason text,
  started_at datetime(3),
  completed_at datetime(3),
  due_at datetime(3),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE (task_id, step_order)
);

CREATE INDEX idx_task_steps_active ON task_step_instances(status, due_at);

CREATE TABLE task_materials (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  task_id bigint NOT NULL,
  requirement_id bigint,
  file_id bigint NOT NULL,
  validation_status varchar(24) NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'passed', 'failed')),
  validation_result json NOT NULL DEFAULT (JSON_OBJECT()),
  submitted_at datetime(3),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE (task_id, requirement_id, file_id)
);

CREATE INDEX idx_task_materials_task_status ON task_materials(task_id, validation_status);

CREATE TABLE task_events (
  id bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,
  task_id bigint NOT NULL,
  actor_user_id bigint,
  actor_organization_id bigint,
  event_type varchar(64) NOT NULL,
  from_status enum('draft', 'in_progress', 'material_required', 'under_review', 'completed', 'cancelled'),
  to_status enum('draft', 'in_progress', 'material_required', 'under_review', 'completed', 'cancelled'),
  title varchar(180) NOT NULL,
  detail json NOT NULL DEFAULT (JSON_OBJECT()),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE INDEX idx_task_events_task_time ON task_events(task_id, created_at, id);

CREATE TABLE generated_documents (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  user_id bigint NOT NULL,
  task_id bigint,
  source_message_id bigint,
  template_key varchar(80) NOT NULL,
  status enum('pending', 'running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  input_data json NOT NULL DEFAULT (JSON_OBJECT()),
  output_file_id bigint,
  error_message text,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  completed_at datetime(3)
);

CREATE INDEX idx_generated_documents_user ON generated_documents(user_id, created_at DESC);

-- 校园新闻与新闻源
CREATE TABLE news_sources (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  organization_id bigint,
  name varchar(160) NOT NULL,
  source_type varchar(24) NOT NULL CHECK (source_type IN ('rss', 'html', 'api', 'manual')),
  source_url text,
  sync_rule json NOT NULL DEFAULT (JSON_OBJECT()),
  is_enabled boolean NOT NULL DEFAULT true,
  last_sync_at datetime(3),
  last_sync_status enum('pending', 'running', 'completed', 'failed', 'cancelled'),
  last_error text,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE campus_news (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  source_id bigint,
  organization_id bigint,
  category varchar(64) NOT NULL COMMENT '分类名称；新闻接口 category 参数直接传此值',
  title text NOT NULL,
  summary text,
  content text NOT NULL,
  cover_file_id bigint,
  source_url text,
  source_document_id bigint,
  status enum('draft', 'published', 'offline', 'archived') NOT NULL DEFAULT 'draft',
  visibility enum('public', 'campus', 'student', 'teacher', 'department', 'admin') NOT NULL DEFAULT 'campus',
  is_spotlight boolean NOT NULL DEFAULT false,
  published_at datetime(3),
  deadline_at datetime(3),
  ai_highlights json NOT NULL DEFAULT (JSON_OBJECT()),
  created_by bigint,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at datetime(3)
);

CREATE INDEX idx_campus_news_feed ON campus_news(status, published_at DESC, deleted_at);
CREATE INDEX idx_campus_news_category ON campus_news(category, status, published_at DESC, deleted_at);
CREATE INDEX idx_campus_news_department ON campus_news(organization_id, status, published_at DESC, deleted_at);
CREATE INDEX idx_campus_news_spotlight ON campus_news(is_spotlight, status, published_at DESC, deleted_at);
CREATE FULLTEXT INDEX idx_campus_news_title_fulltext ON campus_news(title);

CREATE TABLE news_bookmarks (
  user_id bigint NOT NULL,
  news_id bigint NOT NULL,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, news_id)
);

CREATE INDEX idx_news_bookmarks_user_recent ON news_bookmarks(user_id, created_at DESC);

-- 通知
CREATE TABLE notifications (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  user_id bigint NOT NULL,
  notification_type varchar(48) NOT NULL,
  title varchar(180) NOT NULL,
  content text,
  resource_type varchar(48),
  resource_id bigint,
  action_url text,
  is_read boolean NOT NULL DEFAULT false,
  read_at datetime(3),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at datetime(3)
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);

-- 知识处理作业与冲突
CREATE TABLE knowledge_jobs (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  document_id bigint NOT NULL,
  version_id bigint,
  job_type varchar(32) NOT NULL CHECK (job_type IN ('ingest', 'reindex', 'verify', 'offline')),
  status enum('pending', 'running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  current_stage enum('parsing', 'chunking', 'fulltext_indexing', 'publishing'),
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  requested_by bigint,
  error_code varchar(32),
  error_message text,
  started_at datetime(3),
  completed_at datetime(3),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE INDEX idx_knowledge_jobs_queue ON knowledge_jobs(status, created_at);

CREATE TABLE knowledge_job_steps (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  job_id bigint NOT NULL,
  stage enum('parsing', 'chunking', 'fulltext_indexing', 'publishing') NOT NULL,
  status enum('pending', 'running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  elapsed_ms integer CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
  detail json NOT NULL DEFAULT (JSON_OBJECT()),
  started_at datetime(3),
  completed_at datetime(3),
  UNIQUE (job_id, stage)
);

CREATE TABLE knowledge_conflicts (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  document_id bigint NOT NULL,
  conflicting_document_id bigint,
  conflict_type varchar(48) NOT NULL,
  severity varchar(16) NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  description text NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'ignored')),
  resolution text,
  resolved_by bigint,
  resolved_at datetime(3),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE INDEX idx_knowledge_conflicts_pending ON knowledge_conflicts(status, severity, created_at);

-- 幂等记录和审计日志
CREATE TABLE idempotency_records (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  user_id bigint NOT NULL,
  scope varchar(80) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  response_status integer,
  response_body json,
  resource_type varchar(48),
  resource_id bigint,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at datetime(3) NOT NULL,
  UNIQUE (user_id, scope, idempotency_key)
);

CREATE INDEX idx_idempotency_expiry ON idempotency_records(expires_at);

CREATE TABLE audit_logs (
  id bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id varchar(80),
  operator_user_id bigint,
  operator_role enum('student', 'teacher', 'admin'),
  action varchar(80) NOT NULL,
  resource_type varchar(64) NOT NULL,
  resource_id bigint,
  result varchar(16) NOT NULL CHECK (result IN ('success', 'failure')),
  ip_address varchar(45),
  user_agent text,
  before_data json,
  after_data json,
  error_message text,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX idx_audit_logs_operator ON audit_logs(operator_user_id, created_at DESC);
CREATE INDEX idx_audit_logs_time ON audit_logs(created_at DESC);

-- 课程：学期、课程目录、开课班（教学班）、上课时间、先修关系、选课记录
CREATE TABLE academic_terms (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  code varchar(32) NOT NULL UNIQUE COMMENT '学期编码，如 2026-2027-1',
  name varchar(80) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_current boolean NOT NULL DEFAULT false COMMENT '同一时刻只允许一个学期为 true，由服务端保证',
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE courses (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  organization_id bigint COMMENT '开课院系，对应 organizations.id',
  course_code varchar(32) NOT NULL UNIQUE COMMENT '课程编号（教务系统编号）',
  name varchar(160) NOT NULL,
  english_name varchar(200),
  course_type enum('required', 'elective', 'public', 'practice') NOT NULL,
  credit decimal(3, 1) NOT NULL CHECK (credit >= 0),
  total_hours smallint unsigned NOT NULL DEFAULT 0,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at datetime(3)
);

CREATE INDEX idx_courses_org ON courses(organization_id, is_active, deleted_at);
CREATE INDEX idx_courses_name ON courses(name);

CREATE TABLE course_prerequisites (
  course_id bigint NOT NULL,
  prerequisite_course_id bigint NOT NULL,
  PRIMARY KEY (course_id, prerequisite_course_id),
  CHECK (course_id <> prerequisite_course_id)
);

-- 开课班：某学期内某门课程的一个教学班
CREATE TABLE course_offerings (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  course_id bigint NOT NULL,
  term_id bigint NOT NULL,
  section_no varchar(16) NOT NULL COMMENT '教学班号，如 01、02',
  teacher_user_id bigint COMMENT '任课教师，对应 users.id（role = teacher）',
  campus varchar(80),
  capacity smallint unsigned NOT NULL,
  enrolled_count smallint unsigned NOT NULL DEFAULT 0 COMMENT '有效选课人数，选课/退课事务内同步维护',
  selection_status enum('not_open', 'open', 'closed') NOT NULL DEFAULT 'not_open',
  selection_start_at datetime(3),
  selection_end_at datetime(3),
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at datetime(3),
  CHECK (enrolled_count <= capacity),
  UNIQUE KEY uq_course_offerings_section (course_id, term_id, section_no)
);

CREATE INDEX idx_course_offerings_term ON course_offerings(term_id, selection_status, deleted_at);
CREATE INDEX idx_course_offerings_teacher ON course_offerings(teacher_user_id, term_id);

-- 节次表：一天有几节、每节起止时刻由学校作息决定。节次数不写死在代码里，新增节次只改这张表。
-- 注意：course_schedules.start_period / end_period 没有外键，写入时由应用层校验必须存在于本表且 start_period <= end_period。
CREATE TABLE course_periods (
  period_no tinyint PRIMARY KEY COMMENT '第几节，从 1 计',
  name varchar(16) NOT NULL COMMENT '展示名，如 第1节',
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  CHECK (period_no >= 1),
  CHECK (end_time > start_time)
);

INSERT IGNORE INTO course_periods (period_no, name, start_time, end_time)
VALUES
  (1, '第1节', '08:00:00', '08:45:00'),
  (2, '第2节', '08:55:00', '09:40:00'),
  (3, '第3节', '10:00:00', '10:45:00'),
  (4, '第4节', '10:55:00', '11:40:00'),
  (5, '第5节', '14:00:00', '14:45:00'),
  (6, '第6节', '14:55:00', '15:40:00'),
  (7, '第7节', '16:00:00', '16:45:00'),
  (8, '第8节', '16:55:00', '17:40:00'),
  (9, '第9节', '19:00:00', '19:45:00'),
  (10, '第10节', '19:55:00', '20:40:00'),
  (11, '第11节', '20:50:00', '21:35:00'),
  (12, '第12节', '21:45:00', '22:30:00')
;

CREATE TABLE course_schedules (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  offering_id bigint NOT NULL,
  weekday tinyint NOT NULL CHECK (weekday BETWEEN 1 AND 7) COMMENT '1 = 周一，7 = 周日',
  start_period tinyint NOT NULL COMMENT '第几节课开始，从 1 计，取值见 course_periods',
  end_period tinyint NOT NULL COMMENT '第几节课结束，取值见 course_periods',
  week_range varchar(64) NOT NULL DEFAULT '1-16' COMMENT '周次，如 1-16、1-8 单、9-16 双',
  location varchar(120),
  CHECK (end_period >= start_period)
);

CREATE INDEX idx_course_schedules_offering ON course_schedules(offering_id);

CREATE TABLE course_enrollments (
  id bigint PRIMARY KEY AUTO_INCREMENT,
  user_id bigint NOT NULL COMMENT '学生，对应 users.id',
  offering_id bigint NOT NULL,
  status enum('selected', 'dropped', 'completed') NOT NULL DEFAULT 'selected',
  selected_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  dropped_at datetime(3),
  final_grade varchar(16) COMMENT '学期结束后回填，可为空',
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_course_enrollments_user_offering (user_id, offering_id)
);

CREATE INDEX idx_course_enrollments_offering ON course_enrollments(offering_id, status);

-- 基础 Agent 字典
START TRANSACTION;

INSERT IGNORE INTO agents (id, agent_key, name, description, status, supports_attachments)
VALUES
  ('1', 'router_agent', '智能路由 Agent', '识别意图并分发到对应业务智能体', 'online', true),
  ('2', 'policy_agent', '校规与奖助政策 Agent', '检索并解释校规、奖助与荣誉评定政策', 'online', true),
  ('3', 'academic_agent', '教务教学 Agent', '处理选课、考试、学籍和培养方案问题', 'online', true),
  ('4', 'workflow_agent', '事务流转 Agent', '创建任务、核验材料并跟踪办理节点', 'online', true)
;

-- 基础知识分类
INSERT IGNORE INTO knowledge_categories (id, code, name, sort_order)
VALUES
  ('5', 'school-rules', '校规与管理条例', 10),
  ('6', 'academic', '教务与培养管理', 20),
  ('7', 'scholarship', '奖助学金与荣誉评定', 30),
  ('8', 'career', '就业与升学办事', 40),
  ('9', 'campus-life', '宿舍与园区生活', 50)
;

-- ============================================================
-- 本地开发与前端验收测试数据
-- 测试账号：2022010834 / admin1001 / teacher1001
-- 统一测试密码：campusflow123（仅用于本地环境，禁止用于生产环境）
-- ============================================================

-- 组织机构
INSERT IGNORE INTO organizations (id, code, name, short_name, organization_type, contact_phone, contact_email)
VALUES
  ('10', 'CAMPUS', '校园脉络大学', '校园脉络大学', 'university', '010-60000000', 'office@campusflow.test')
;

INSERT IGNORE INTO organizations (id, parent_id, code, name, short_name, organization_type, contact_phone, contact_email)
VALUES
  ('11', '10', 'CS', '计算机科学与技术学院', '计算机学院', 'college', '010-60001001', 'cs@campusflow.test'),
  ('12', '10', 'ACADEMIC', '教务处', '教务处', 'department', '010-60002001', 'academic@campusflow.test'),
  ('13', '10', 'STUDENT_AFFAIRS', '党委学生工作部', '学工部', 'department', '010-60003001', 'student@campusflow.test'),
  ('14', '13', 'FINANCIAL_AID', '学生资助管理中心', '资助中心', 'center', '010-60003002', 'aid@campusflow.test'),
  ('15', '10', 'LOGISTICS', '后勤保障部', '后勤部', 'department', '010-60004001', 'logistics@campusflow.test'),
  ('16', '10', 'CAREER', '学生就业指导中心', '就业中心', 'center', '010-60005001', 'career@campusflow.test'),
  ('17', '10', 'IT_OFFICE', '信息化建设办公室', '信息办', 'department', '010-60006001', 'it@campusflow.test')
;

-- 用户及登录凭据
INSERT IGNORE INTO users (
  id, organization_id, account, name, role, department_name,
  student_or_staff_no, email, is_active, last_login_at, created_at, updated_at
)
VALUES
  ('18', '11', '2022010834', '林晨', 'student', '计算机科学与技术学院', '2022010834', 'linchen@campusflow.test', true, '2026-09-04 08:30:00', '2022-09-01 08:00:00', '2026-09-04 08:30:00'),
  ('19', '17', 'admin1001', '周老师', 'admin', '信息化建设办公室', 'A1001', 'zhou@campusflow.test', true, '2026-09-04 08:10:00', '2024-01-10 09:00:00', '2026-09-04 08:10:00'),
  ('20', '12', 'teacher1001', '陈老师', 'teacher', '教务处', 'T1001', 'chen@campusflow.test', true, '2026-09-03 16:40:00', '2024-02-20 09:00:00', '2026-09-03 16:40:00')
;

INSERT IGNORE INTO user_credentials (user_id, password_hash, password_algorithm, password_changed_at)
VALUES
  ('18', SHA2('campusflow123', 256), 'sha256-test', '2026-09-01 09:00:00'),
  ('19', SHA2('campusflow123', 256), 'sha256-test', '2026-09-01 09:00:00'),
  ('20', SHA2('campusflow123', 256), 'sha256-test', '2026-09-01 09:00:00')
;

INSERT IGNORE INTO user_preferences (
  user_id, default_agent_mode, answer_length, show_citations,
  task_notifications, knowledge_notifications, history_retention_days
)
VALUES
  ('18', 'auto', 'balanced', true, true, true, 365),
  ('19', 'auto', 'detailed', true, true, true, 730),
  ('20', 'academic', 'balanced', true, true, false, 365)
;

-- 仅供本地联调的登录会话哈希，不保存可直接使用的 Refresh Token
INSERT IGNORE INTO user_sessions (
  id, user_id, refresh_token_hash, status, user_agent, ip_address,
  expires_at, last_used_at, created_at
)
VALUES
  ('21', '18', SHA2('campusflow-test-refresh-20260904', 256), 'active', 'CampusFlow-Test-Client', '127.0.0.1', '2026-10-04 08:30:00', '2026-09-04 08:30:00', '2026-09-04 08:30:00'),
  ('22', '19', SHA2('campusflow-admin-refresh-20260904', 256), 'active', 'CampusFlow-Test-Client', '127.0.0.1', '2026-10-04 08:10:00', '2026-09-04 08:10:00', '2026-09-04 08:10:00')
;

-- 文件元数据
INSERT IGNORE INTO files (
  id, owner_id, purpose, original_name, object_key, content_type,
  size_bytes, sha256, status, uploaded_at
)
VALUES
  ('23', '19', 'knowledge_source', '国家奖学金评选实施细则.pdf', 'test/knowledge/national-scholarship-2026.pdf', 'application/pdf', 863240, repeat('a', 64), 'ready', '2026-08-20 10:00:00'),
  ('24', '19', 'knowledge_source', '本科生学籍管理规定.pdf', 'test/knowledge/undergraduate-status-2026.pdf', 'application/pdf', 1258240, repeat('b', 64), 'ready', '2026-08-21 10:00:00'),
  ('25', '19', 'knowledge_source', '综合素质测评实施办法.pdf', 'test/knowledge/comprehensive-evaluation-2026.pdf', 'application/pdf', 734120, repeat('c', 64), 'ready', '2026-08-22 10:00:00'),
  ('26', '19', 'knowledge_source', '国家奖学金评选办法（2024版）.pdf', 'test/knowledge/national-scholarship-2024.pdf', 'application/pdf', 692450, repeat('d', 64), 'ready', '2024-08-20 10:00:00'),
  ('27', '18', 'task_material', '学生证补办申请表.pdf', 'test/materials/2022010834/student-card-form.pdf', 'application/pdf', 156240, repeat('e', 64), 'ready', '2026-09-03 14:20:00'),
  ('28', '18', 'task_material', '个人成绩单.pdf', 'test/materials/2022010834/transcript.pdf', 'application/pdf', 245860, repeat('f', 64), 'ready', '2026-09-02 11:10:00')
;

-- 知识文档、版本与正文切片
INSERT IGNORE INTO knowledge_documents (
  id, category_id, issuer_organization_id, title, document_no, issuer_level,
  validity, visibility, status, summary, published_at, effective_from,
  reference_count, created_by
)
VALUES
  ('29', '7', '14', '国家奖学金评选实施细则', '校学字〔2026〕18号', 'school', 'current', 'student', 'ready', '明确国家奖学金申请条件、材料要求与评审流程。', '2026-08-20 09:00:00', '2026-09-01', 128, '19'),
  ('30', '6', '12', '本科生学籍管理规定', '校教字〔2026〕12号', 'school', 'current', 'campus', 'ready', '包含选课、学籍异动、休复学与毕业审核规定。', '2026-08-21 09:00:00', '2026-09-01', 96, '19'),
  ('31', '5', '13', '综合素质测评实施办法', '校学字〔2026〕21号', 'school', 'current', 'student', 'ready', '本科生综合素质测评指标、加分规则与公示要求。', '2026-08-22 09:00:00', '2026-09-01', 74, '19'),
  ('32', '7', '14', '国家奖学金评选办法（2024版）', '校学字〔2024〕16号', 'school', 'archive', 'student', 'archived', '历史版本，仅供制度沿革查询。', '2024-08-20 09:00:00', '2024-09-01', 31, '19')
;

INSERT IGNORE INTO knowledge_document_versions (
  id, document_id, source_file_id, version_no, is_current, status,
  signature_algorithm, signature_digest, signature_verified,
  signature_verified_at, page_count, parser_name, chunk_count, metadata,
  created_by, created_at
)
VALUES
  ('33', '29', '23', '2026.1', true, 'ready', 'SHA-256', repeat('1', 64), true, '2026-08-20 10:05:00', 18, 'pdf-text', 14, '{"source":"校内公文系统"}', '19', '2026-08-20 10:00:00'),
  ('34', '30', '24', '2026.1', true, 'ready', 'SHA-256', repeat('2', 64), true, '2026-08-21 10:05:00', 32, 'pdf-text', 2, '{"source":"校内公文系统"}', '19', '2026-08-21 10:00:00'),
  ('35', '31', '25', '2026.1', true, 'ready', 'SHA-256', repeat('3', 64), true, '2026-08-22 10:05:00', 24, 'pdf-text', 1, '{"source":"学生工作部"}', '19', '2026-08-22 10:00:00'),
  ('36', '32', '26', '2024.1', true, 'archived', 'SHA-256', repeat('4', 64), true, '2024-08-20 10:05:00', 16, 'pdf-text', 1, '{"source":"历史归档"}', '19', '2024-08-20 10:00:00')
;

INSERT IGNORE INTO knowledge_sections (
  id, version_id, chapter_no, article_no, chunk_index, heading,
  section_label, content, page_start, page_end, token_count, metadata
)
VALUES
  ('37', '33', 2, 5, 0, '申请条件', '第二章第五条', '申请人须为全日制在校本科生，学习成绩与综合测评成绩排名均位于专业前10%；其他方面表现突出者可按规定申请。', 4, 4, 62, '{"keywords":["国家奖学金","申请条件"]}'),
  ('38', '33', 3, 8, 1, '申请材料与流程', '第三章第八条', '申请材料包括申请审批表、成绩单和获奖证明。学生线上提交后，由学院初审、学校评审并公示。', 7, 8, 55, '{"keywords":["申请材料","评审流程"]}'),
  ('39', '34', 4, 18, 0, '学生证补办', '第四章第十八条', '学生证遗失后应提交补办申请、本人证件照，并完成学院审核和制证缴费。', 12, 12, 43, '{"keywords":["学生证","补办"]}'),
  ('40', '34', 2, 7, 1, '选课管理', '第二章第七条', '学生应在规定时间内完成选课、退补选及课程确认，逾期调整须向开课单位提出申请。', 6, 7, 47, '{"keywords":["选课","退补选"]}'),
  ('41', '35', 3, 10, 0, '测评加分', '第三章第十条', '竞赛、科研、志愿服务等项目按照附件标准计入综合素质测评，材料须真实有效。', 9, 10, 46, '{"keywords":["综测","加分"]}'),
  ('42', '36', 2, 4, 0, '历史申请条件', '第二章第四条', '本条为2024年度评选要求，已由2026年实施细则替代。', 3, 4, 32, '{"keywords":["历史版本"]}'),
  -- 文档29（version 33）完整章节树：article_no 为 NULL 的是「章标题行」，heading 存章标题，供接口 A.6.4 聚合章目录使用
  ('43', '33', 1, NULL, 2, '总则', '第一章', '为规范国家奖学金评选工作，发挥奖学金的激励导向作用，根据教育部有关文件精神，结合学校实际，制定本细则。', 1, 1, 45, '{"keywords":["国家奖学金","总则"]}'),
  ('44', '33', 1, 1, 3, '评选范围', '第一章第一条', '本细则适用于全日制在校本科生国家奖学金的评选工作。', 2, 2, 24, '{"keywords":["国家奖学金","评选范围"]}'),
  ('45', '33', 1, 2, 4, '评选名额', '第一章第二条', '国家奖学金名额由教育主管部门下达，学校按下达名额等额评审。', 2, 2, 29, '{"keywords":["国家奖学金","评选名额"]}'),
  ('46', '33', 1, 3, 5, '组织分工', '第一章第三条', '学生资助管理中心负责全校评选工作的统筹组织，各学院负责本单位学生的申请受理与资格审查。', 3, 3, 41, '{"keywords":["国家奖学金","组织分工"]}'),
  ('47', '33', 2, NULL, 6, '申请条件', '第二章', '本章规定申请国家奖学金应当具备的基本资格、基本条件以及同等条件下的优先情形。', 3, 3, 37, '{"keywords":["国家奖学金","申请条件"]}'),
  ('48', '33', 2, 4, 7, '基本资格', '第二章第四条', '申请人应当热爱社会主义祖国，拥护中国共产党的领导，遵守宪法和法律，诚实守信，道德品质优良。', 4, 4, 44, '{"keywords":["国家奖学金","基本资格"]}'),
  ('49', '33', 2, 6, 8, '优先条件', '第二章第六条', '学习成绩与综合考评成绩处于同一排序区间时，服役期满复学的学生、志愿服务与社会实践表现突出的学生优先考虑。', 5, 5, 51, '{"keywords":["国家奖学金","优先条件"]}'),
  ('50', '33', 3, NULL, 9, '申请材料与流程', '第三章', '本章规定申请国家奖学金所需提交的材料、申请程序以及评审与公示要求。', 6, 6, 32, '{"keywords":["国家奖学金","申请材料"]}'),
  ('51', '33', 3, 7, 10, '申请程序', '第三章第七条', '学生在规定时限内通过学工系统在线提交申请，学院完成初审并公示后，报学校评审领导小组复核。', 6, 7, 44, '{"keywords":["国家奖学金","申请程序"]}'),
  ('52', '33', 3, 9, 11, '评审与公示', '第三章第九条', '学校评审领导小组按照下达名额组织评审，评审结果在校内公示不少于五个工作日，公示无异议后报教育主管部门备案。', 8, 8, 52, '{"keywords":["国家奖学金","评审公示"]}'),
  ('53', '33', 4, NULL, 12, '附则', '第四章', '本章规定细则的解释权归属与施行日期。', 9, 9, 18, '{"keywords":["国家奖学金","附则"]}'),
  ('54', '33', 4, 10, 13, '解释与施行', '第四章第十条', '本细则由学生资助管理中心负责解释，自2026年9月1日起施行，原有相关规定同时废止。', 9, 9, 40, '{"keywords":["国家奖学金","施行"]}')
;

-- 历史会话、消息与业务处理记录
INSERT IGNORE INTO conversations (
  id, user_id, title, agent_mode, source, status, is_bookmarked,
  last_message_at, created_at, updated_at
)
VALUES
  ('43', '18', '国家奖学金申请条件与评选标准', 'auto', 'workspace', 'active', true, '2026-09-04 09:03:12', '2026-09-04 09:00:00', '2026-09-04 09:03:12'),
  ('44', '18', '学生证丢失补办流程', 'workflow', 'workspace', 'archived', false, '2026-09-03 14:18:20', '2026-09-03 14:15:00', '2026-09-03 14:18:20'),
  ('45', '18', '秋季学期退补选时间', 'academic', 'workspace', 'active', false, '2026-09-02 10:25:00', '2026-09-02 10:22:00', '2026-09-02 10:25:00')
;

INSERT IGNORE INTO messages (
  id, conversation_id, role, status, content, grounded, confidence,
  elapsed_ms, token_usage, created_at, completed_at
)
VALUES
  ('46', '43', 'user', 'completed', '申请国家奖学金需要满足哪些条件？需要准备什么材料？', NULL, NULL, NULL, '{}', '2026-09-04 09:00:00', '2026-09-04 09:00:00'),
  ('47', '43', 'assistant', 'completed', '申请人通常需要满足全日制在校、成绩与综合测评排名要求。请准备申请审批表、成绩单和获奖证明，依次经过学院初审、学校评审与公示。具体以当年通知为准。', true, 0.9600, 1320, '{"input":26,"output":91}', '2026-09-04 09:00:03', '2026-09-04 09:00:04'),
  ('48', '44', 'user', 'completed', '学生证丢了，在哪里补办？', NULL, NULL, NULL, '{}', '2026-09-03 14:15:00', '2026-09-03 14:15:00'),
  ('49', '44', 'assistant', 'completed', '可在线发起学生证补办。请填写补办申请并上传证件照，学院审核通过后完成缴费，随后等待制证与领取通知。', true, 0.9400, 980, '{"input":16,"output":68}', '2026-09-03 14:15:02', '2026-09-03 14:15:03'),
  ('50', '45', 'user', 'completed', '秋季学期退补选截止到什么时候？', NULL, NULL, NULL, '{}', '2026-09-02 10:22:00', '2026-09-02 10:22:00'),
  ('51', '45', 'assistant', 'completed', '退补选开放时间为9月2日至9月8日，请在教务系统中完成课程确认。', true, 0.9100, 760, '{"input":18,"output":42}', '2026-09-02 10:22:02', '2026-09-02 10:22:03')
;

INSERT IGNORE INTO message_citations (
  id, message_id, document_id, version_id, section_id,
  citation_order, excerpt, similarity, created_at
)
VALUES
  ('52', '47', '29', '33', '37', 1, '学习成绩与综合测评成绩排名均位于专业前10%。', 0.96120, '2026-09-04 09:00:04'),
  ('53', '47', '29', '33', '38', 2, '材料包括申请审批表、成绩单和获奖证明。', 0.94810, '2026-09-04 09:00:04'),
  ('54', '49', '30', '34', '39', 1, '学生证遗失后应提交补办申请、本人证件照。', 0.94260, '2026-09-03 14:15:03')
;

INSERT IGNORE INTO agent_runs (
  id, conversation_id, request_message_id, response_message_id,
  selected_agent_id, status, route_reason, started_at, completed_at,
  elapsed_ms, created_at
)
VALUES
  ('55', '43', '46', '47', '2', 'completed', '问题涉及国家奖学金政策与申请材料。', '2026-09-04 09:00:02', '2026-09-04 09:00:04', 1320, '2026-09-04 09:00:02'),
  ('56', '44', '48', '49', '4', 'completed', '问题涉及可在线办理的学生证补办流程。', '2026-09-03 14:15:01', '2026-09-03 14:15:03', 980, '2026-09-03 14:15:01')
;

INSERT IGNORE INTO agent_run_steps (
  id, run_id, agent_id, step_order, step_key, label, status,
  input_summary, output_summary, elapsed_ms, started_at, completed_at
)
VALUES
  ('57', '55', '1', 1, 'route', '识别事务类型', 'completed', '国家奖学金申请咨询', '路由至校规与奖助政策业务助手', 120, '2026-09-04 09:00:02', '2026-09-04 09:00:02'),
  ('58', '55', '2', 2, 'lookup', '查询有效制度', 'completed', '查询申请条件和材料', '找到2026年有效实施细则', 480, '2026-09-04 09:00:02', '2026-09-04 09:00:03'),
  ('59', '55', '2', 3, 'compose', '整理办理答复', 'completed', '整理条件、材料和流程', '生成带来源的答复', 720, '2026-09-04 09:00:03', '2026-09-04 09:00:04'),
  ('60', '56', '4', 1, 'workflow', '匹配办理流程', 'completed', '学生证补办', '匹配学生证补办事项模板', 980, '2026-09-03 14:15:01', '2026-09-03 14:15:03')
;

INSERT IGNORE INTO message_feedback (id, message_id, user_id, rating, reason, created_at)
VALUES
  ('61', '47', '18', 'helpful', '条件和材料说明清楚。', '2026-09-04 09:03:12')
;

-- 办事模板与测试任务
INSERT IGNORE INTO task_templates (
  id, template_key, name, responsible_organization_id, description,
  form_schema, version, is_active
)
VALUES
  ('62', 'student-card-reissue', '学生证补办', '12', '学生证遗失或损坏后的线上补办流程。', '{"fields":["reason","photo"]}', 1, true),
  ('63', 'national-scholarship-review', '国家奖学金线上预审', '14', '国家奖学金申请材料线上预审。', '{"fields":["academicYear","ranking","awards"]}', 1, true),
  ('64', 'course-adjustment', '课程退补选申请', '12', '超过常规退补选阶段后的课程调整申请。', '{"fields":["courseCode","reason"]}', 1, true)
;

INSERT IGNORE INTO task_template_steps (
  id, template_id, step_order, name, organization_id,
  expected_minutes, requires_user_action, config
)
VALUES
  ('65', '62', 1, '提交补办材料', '11', 10, true, '{}'),
  ('66', '62', 2, '学院审核', '11', 2880, false, '{}'),
  ('67', '62', 3, '教务制证', '12', 7200, false, '{}'),
  ('68', '63', 1, '填写申请信息', '14', 15, true, '{}'),
  ('69', '63', 2, '材料预审', '14', 1440, false, '{}'),
  ('70', '64', 1, '提交课程调整申请', '12', 10, true, '{}'),
  ('71', '64', 2, '教务审核', '12', 1440, false, '{}')
;

INSERT IGNORE INTO task_template_requirements (
  id, template_id, requirement_key, name, description,
  allowed_content_types, max_size_bytes, is_required, sort_order
)
VALUES
  ('72', '62', 'application-form', '学生证补办申请表', '填写并签字后的申请表。', JSON_ARRAY('application/pdf'), 10485760, true, 10),
  ('73', '62', 'id-photo', '近期证件照', '白底免冠电子证件照。', JSON_ARRAY('image/jpeg', 'image/png'), 5242880, true, 20),
  ('74', '63', 'transcript', '个人成绩单', '由教务系统导出的完整成绩单。', JSON_ARRAY('application/pdf'), 10485760, true, 10),
  ('75', '63', 'award-proof', '获奖证明', '竞赛或荣誉证明材料。', JSON_ARRAY('application/pdf', 'image/jpeg', 'image/png'), 20971520, true, 20)
;

INSERT IGNORE INTO tasks (
  id, task_no, user_id, template_id, source_conversation_id,
  source_message_id, title, status, responsible_organization_id,
  current_step_order, form_data, submitted_at, completed_at,
  created_at, updated_at
)
VALUES
  ('76', 'CF202609030001', '18', '62', '44', '49', '学生证补办申请', 'material_required', '12', 1, '{"reason":"遗失","pickupCampus":"主校区"}', NULL, NULL, '2026-09-03 14:18:20', '2026-09-04 08:45:00'),
  ('77', 'CF202609020001', '18', '63', '43', '47', '国家奖学金线上预审', 'in_progress', '14', 2, '{"academicYear":"2025-2026","ranking":"3/86"}', '2026-09-02 11:12:00', NULL, '2026-09-02 10:40:00', '2026-09-04 08:20:00'),
  ('78', 'CF202608280001', '18', '64', '45', '51', '课程退补选申请', 'completed', '12', 2, '{"courseCode":"CS402","reason":"培养方案调整"}', '2026-08-28 10:00:00', '2026-08-30 16:30:00', '2026-08-28 09:45:00', '2026-08-30 16:30:00')
;

INSERT IGNORE INTO task_step_instances (
  id, task_id, template_step_id, step_order, name, status,
  organization_id, assignee_user_id, result, started_at,
  completed_at, due_at
)
VALUES
  ('79', '76', '65', 1, '提交补办材料', 'active', '11', NULL, '{"missing":["id-photo"]}', '2026-09-03 14:18:20', NULL, '2026-09-06 18:00:00'),
  ('80', '76', '66', 2, '学院审核', 'pending', '11', '20', '{}', NULL, NULL, NULL),
  ('81', '77', '68', 1, '填写申请信息', 'completed', '14', NULL, '{}', '2026-09-02 10:40:00', '2026-09-02 11:12:00', NULL),
  ('82', '77', '69', 2, '材料预审', 'active', '14', '19', '{"checked":1,"total":2}', '2026-09-03 09:00:00', NULL, '2026-09-05 18:00:00'),
  ('83', '78', '70', 1, '提交课程调整申请', 'completed', '12', NULL, '{}', '2026-08-28 09:45:00', '2026-08-28 10:00:00', NULL),
  ('84', '78', '71', 2, '教务审核', 'completed', '12', '20', '{"approved":true}', '2026-08-29 09:00:00', '2026-08-30 16:30:00', NULL)
;

INSERT IGNORE INTO task_materials (
  id, task_id, requirement_id, file_id, validation_status,
  validation_result, submitted_at
)
VALUES
  ('85', '76', '72', '27', 'passed', '{"message":"文件格式与大小符合要求"}', '2026-09-03 14:20:00'),
  ('86', '77', '74', '28', 'passed', '{"message":"成绩单信息完整"}', '2026-09-02 11:10:00')
;

INSERT IGNORE INTO task_events (
  id, task_id, actor_user_id, actor_organization_id, event_type,
  from_status, to_status, title, detail, created_at
)
VALUES
  (900001, '76', '18', NULL, 'created', NULL, 'draft', '已创建学生证补办申请', '{}', '2026-09-03 14:18:20'),
  (900002, '76', NULL, '11', 'material_requested', 'draft', 'material_required', '请补充近期证件照', '{"requirementKey":"id-photo"}', '2026-09-04 08:45:00'),
  (900003, '77', '18', NULL, 'submitted', 'draft', 'in_progress', '国家奖学金预审已提交', '{}', '2026-09-02 11:12:00'),
  (900004, '78', '20', '12', 'approved', 'under_review', 'completed', '课程调整申请已通过', '{}', '2026-08-30 16:30:00');

-- 校园新闻、收藏与通知
INSERT IGNORE INTO news_sources (
  id, organization_id, name, source_type, source_url,
  is_enabled, last_sync_at, last_sync_status
)
VALUES
  ('87', '17', '校园门户新闻中心', 'api', 'https://campusflow.test/news', true, '2026-09-04 07:30:00', 'completed'),
  ('88', '12', '教务通知', 'manual', 'https://campusflow.test/academic/notices', true, '2026-09-04 08:00:00', 'completed')
;

INSERT IGNORE INTO campus_news (
  id, source_id, organization_id, category, title, summary, content,
  source_url, source_document_id, status, visibility, is_spotlight,
  published_at, deadline_at, created_by
)
VALUES
  ('89', '88', '12', '教务', '2026年本科生转专业工作正式启动', '转专业申请通道现已开放，请符合条件的学生按时提交申请。', '本年度本科生转专业工作于9月4日启动。学生应登录教务系统查看专业接收计划，于9月15日前完成申请。', 'https://campusflow.test/news/transfer-2026', NULL, 'published', 'student', true, '2026-09-04 08:00:00', '2026-09-15 17:00:00', '19'),
  ('90', '87', '12', '国际交流', '2027年春季学期交换项目开始报名', '首批合作院校项目开放申请，报名截止时间为9月20日。', '国际交流项目面向全日制本科生开放，申请人须满足学业成绩和语言能力要求。', 'https://campusflow.test/news/exchange-2027', NULL, 'published', 'student', false, '2026-09-03 15:30:00', '2026-09-20 17:00:00', '19'),
  ('91', '87', '17', '服务通知', '校园卡系统维护通知', '9月6日凌晨校园卡充值服务将短时暂停。', '为提升系统稳定性，校园卡充值服务将于9月6日0:00至2:00暂停，实体卡消费不受影响。', 'https://campusflow.test/news/card-maintenance', NULL, 'published', 'campus', false, '2026-09-03 10:00:00', NULL, '19'),
  ('92', '87', '14', '奖助学金', '2026年度国家奖学金申请通知', '线上申请已开放，请申请人准备成绩单与获奖证明。', '申请人请于9月18日前完成线上申请，学院将组织资格审核和公开评议。', 'https://campusflow.test/news/scholarship-2026', '29', 'published', 'student', false, '2026-09-02 09:00:00', '2026-09-18 17:00:00', '19'),
  ('93', '87', '16', '就业', '秋季校园双选会参会单位名单发布', '首场双选会将有120家用人单位到校招聘。', '双选会将于9月12日在大学生活动中心举行，请毕业生提前完善简历并预约入场。', 'https://campusflow.test/news/career-fair-2026', NULL, 'published', 'student', false, '2026-09-01 14:00:00', '2026-09-12 17:00:00', '19')
;

INSERT IGNORE INTO news_bookmarks (user_id, news_id, created_at)
VALUES
  ('18', '89', '2026-09-04 08:35:00'),
  ('18', '92', '2026-09-04 08:36:00')
;

INSERT IGNORE INTO notifications (
  id, user_id, notification_type, title, content, resource_type,
  resource_id, action_url, is_read, read_at, created_at, expires_at
)
VALUES
  ('94', '18', 'task_material_required', '学生证补办还需一项材料', '请上传近期白底证件照后继续提交。', 'task', '76', '/tasks/76', false, NULL, '2026-09-04 08:45:00', '2026-09-11 23:59:59'),
  ('95', '18', 'deadline_reminder', '国家奖学金申请即将截止', '线上申请截止时间为9月18日17:00。', 'news', '92', '/news/92', false, NULL, '2026-09-04 08:50:00', '2026-09-18 17:00:00'),
  ('96', '18', 'task_completed', '课程退补选申请已通过', '课程CS402已加入本学期课表。', 'task', '78', '/tasks/78', true, '2026-08-30 17:00:00', '2026-08-30 16:30:00', NULL)
;

-- 文档处理记录（仅使用常规解析与全文检索阶段）
INSERT IGNORE INTO knowledge_jobs (
  id, document_id, version_id, job_type, status, current_stage,
  progress, attempt_count, requested_by, started_at, completed_at, created_at
)
VALUES
  ('97', '29', '33', 'ingest', 'completed', 'publishing', 100, 1, '19', '2026-08-20 10:00:00', '2026-08-20 10:06:00', '2026-08-20 09:59:00')
;

INSERT IGNORE INTO knowledge_job_steps (
  id, job_id, stage, status, progress, elapsed_ms, detail,
  started_at, completed_at
)
VALUES
  ('98', '97', 'parsing', 'completed', 100, 92000, '{"pages":18}', '2026-08-20 10:00:00', '2026-08-20 10:01:32'),
  ('99', '97', 'chunking', 'completed', 100, 48000, '{"sections":2}', '2026-08-20 10:01:32', '2026-08-20 10:02:20'),
  ('100', '97', 'fulltext_indexing', 'completed', 100, 35000, '{"indexed":2}', '2026-08-20 10:02:20', '2026-08-20 10:02:55'),
  ('101', '97', 'publishing', 'completed', 100, 185000, '{"status":"ready"}', '2026-08-20 10:02:55', '2026-08-20 10:06:00')
;

-- 课程：学期、课程目录、先修、开课班、上课时间、选课记录
-- 任课教师沿用已有用户 20（陈老师），不新增账号
INSERT IGNORE INTO academic_terms (id, code, name, start_date, end_date, is_current)
VALUES
  ('1', '2025-2026-2', '2025—2026 学年第二学期', '2026-02-23', '2026-07-10', false),
  ('2', '2026-2027-1', '2026—2027 学年第一学期', '2026-09-01', '2027-01-20', true)
;

INSERT IGNORE INTO courses (
  id, organization_id, course_code, name, english_name, course_type,
  credit, total_hours, description, is_active
)
VALUES
  ('101', '11', 'CS1001', '程序设计基础', 'Fundamentals of Programming', 'required', 4.0, 64, '以 C 语言为载体，介绍程序设计的基本思想、控制结构与数组、函数等基础内容。', true),
  ('102', '11', 'CS2001', '数据结构', 'Data Structures', 'required', 4.0, 64, '线性表、栈、队列、树与图的基本结构及常用算法。', true),
  ('103', '11', 'CS2002', '操作系统', 'Operating Systems', 'required', 3.5, 56, '进程与线程、内存管理、文件系统与并发控制。', true),
  ('104', '11', 'CS3010', '数据库系统原理', 'Database Systems', 'elective', 3.0, 48, '关系模型、SQL、规范化理论与事务管理。', true),
  ('105', '11', 'CS3020', '人工智能导论', 'Introduction to Artificial Intelligence', 'elective', 2.0, 32, '搜索、知识表示与机器学习入门。', true),
  ('106', '12', 'GE1001', '大学英语（三）', 'College English III', 'public', 2.0, 32, '学术英语阅读与写作训练。', true),
  ('107', '11', 'CS4001', '专业实习', 'Professional Internship', 'practice', 2.0, 0, '校外或校内实训基地的专业实践，按实习报告计分。', true)
;

INSERT IGNORE INTO course_prerequisites (course_id, prerequisite_course_id)
VALUES
  ('102', '101'),
  ('103', '102'),
  ('104', '102'),
  ('105', '102')
;

-- 开课班：当前学期（id = 2）
-- enrolled_count 与下方 selected 状态的选课记录数一致
INSERT IGNORE INTO course_offerings (
  id, course_id, term_id, section_no, teacher_user_id, campus,
  capacity, enrolled_count, selection_status, selection_start_at, selection_end_at
)
VALUES
  ('501', '101', '2', '01', '20', '东校区', 120, 1, 'open', '2026-09-01 08:00:00', '2026-10-31 22:00:00'),
  ('502', '102', '2', '01', '20', '东校区', 80, 0, 'open', '2026-09-01 08:00:00', '2026-10-31 22:00:00'),
  ('503', '103', '2', '01', NULL, '东校区', 80, 0, 'not_open', '2026-10-20 08:00:00', '2026-10-30 22:00:00'),
  ('504', '104', '2', '01', NULL, '东校区', 60, 0, 'open', '2026-09-01 08:00:00', '2026-10-31 22:00:00'),
  ('505', '105', '2', '01', NULL, '西校区', 40, 0, 'closed', '2026-08-20 08:00:00', '2026-09-10 22:00:00'),
  ('506', '106', '2', '01', NULL, '西校区', 100, 0, 'open', '2026-09-01 08:00:00', '2026-10-31 22:00:00'),
  ('507', '107', '2', '01', NULL, '东校区', 50, 0, 'not_open', NULL, NULL)
;

-- 上课时间：506 与 501 周一第 1–2 节重叠，用于验证 schedule_conflict
INSERT IGNORE INTO course_schedules (id, offering_id, weekday, start_period, end_period, week_range, location)
VALUES
  ('7001', '501', 1, 1, 2, '1-16', '信息楼 301'),
  ('7002', '501', 3, 3, 4, '1-16', '信息楼 301'),
  ('7003', '502', 2, 1, 2, '1-16', '教学楼 A201'),
  ('7004', '503', 4, 1, 2, '1-8', '教学楼 B105'),
  ('7005', '504', 5, 3, 4, '1-16', '信息楼 405'),
  ('7006', '505', 2, 5, 6, '1-16', '教学楼 B301'),
  ('7007', '506', 1, 1, 2, '1-16', '外语楼 214'),
  ('7008', '506', 4, 3, 4, '1-16', '外语楼 214')
;

-- 选课记录：林晨（18）选了 CS1001 01 班；已退 大学英语（三）
INSERT IGNORE INTO course_enrollments (
  id, user_id, offering_id, status, selected_at, dropped_at, final_grade
)
VALUES
  ('9001', '18', '501', 'selected', '2026-09-03 10:12:00', NULL, NULL),
  ('9002', '18', '506', 'dropped', '2026-09-02 09:00:00', '2026-09-04 10:00:00', NULL)
;

INSERT IGNORE INTO audit_logs (
  id, request_id, operator_user_id, operator_role, action, resource_type,
  resource_id, result, ip_address, user_agent, after_data, created_at
)
VALUES
  (900001, 'test-login-20260904-001', '18', 'student', 'user.login', 'user', '18', 'success', '127.0.0.1', 'CampusFlow-Test-Client', '{"account":"2022010834"}', '2026-09-04 08:30:00'),
  (900002, 'test-task-20260903-001', '18', 'student', 'task.create', 'task', '76', 'success', '127.0.0.1', 'CampusFlow-Test-Client', '{"taskNo":"CF202609030001"}', '2026-09-03 14:18:20');

COMMIT;

-- 生产落地补充要求：
-- 1. 应用账号不得拥有 DROP SCHEMA、SUPERUSER 或直接读取凭据表的权限。
-- 2. 对 users、conversations、tasks、files、notifications 启用基于 user_id 的行级权限或在服务层强制资源归属校验。
-- 3. campus_news、knowledge_documents 的 department 可见范围应在查询层同时校验用户角色和组织关系。
-- 4. audit_logs、task_events 建议按月分区；messages 和 knowledge_sections 数据量较大时按创建时间或文档版本分区。
-- 5. 定期清理已过期 user_sessions、idempotency_records、下载链接缓存和达到保留期限的软删除数据。
