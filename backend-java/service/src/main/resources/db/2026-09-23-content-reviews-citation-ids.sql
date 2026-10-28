-- ============================================================================
-- content_reviews 补 citation_ids（2026-09-23）
--
-- 背景：`POST /admin/reviews/{id}/resolve` 的请求体里有 `citation_ids`（订正后保留的
-- 引用来源），但建表时漏了这一列 —— 接口收下它就再也找不到了，等于静默丢数据。
--
-- 为什么单放一个文件：MySQL 8.0 的 ALTER TABLE 没有 IF NOT EXISTS，
-- 混进 2026-09-23-admin-console.sql（那个文件是可反复执行的）第二次跑就会报
-- Duplicate column name。改列一律单文件 + 由 tools/apply-admin-console-ddl.sh
-- 先查 information_schema 再决定跑不跑。
--
-- ⚠️ 用 json 而不是 varchar：引用 id 是变长列表，存成逗号串之后
-- 「取某一版引用的原文」这种查询就没法用 JSON 函数做，而且容易被半角逗号污染。
-- ============================================================================

USE campus_flow;
SET NAMES utf8mb4;

ALTER TABLE content_reviews
  ADD COLUMN citation_ids json NULL COMMENT '订正后保留的引用 id 列表，JSON 数组；未订正时为 NULL'
  AFTER corrected_answer;
