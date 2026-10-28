-- 500 人压测准备：新开课程 101 的班 509（容量 80，无先修），并补齐学生 stress201 ~ stress500。
-- 仅用于本地压测环境，密码 0706 的哈希复制自用户 18（2022010834）。

INSERT IGNORE INTO course_offerings (id, course_id, term_id, section_no, teacher_user_id, campus, capacity, enrolled_count, selection_status, selection_start_at, selection_end_at)
VALUES (509, 101, 2, '03', 20, '东校区', 80, 0, 'open', '2026-09-01 00:00:00.000', '2026-12-31 23:59:59.000');

-- 509 的上课时间：周三 3–4 节，1–16 周，东校区 B201
INSERT IGNORE INTO course_schedules (id, offering_id, weekday, start_period, end_period, week_range, location)
VALUES (7010, 509, 3, 3, 4, '1-16', '东校区 B201');

-- 学生 stress201 ~ stress500（id 3201 ~ 3500）
INSERT IGNORE INTO users (id, organization_id, account, name, role, department_name, student_or_staff_no, is_active, created_at, updated_at)
WITH RECURSIVE seq AS (
  SELECT 201 AS n
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 500
)
SELECT 3000 + n, '11', CONCAT('stress', LPAD(n, 3, '0')), CONCAT('压测学生', LPAD(n, 3, '0')),
  'student', '计算机科学与技术学院', CONCAT('STRESS', LPAD(n, 3, '0')), true,
  '2026-09-01 08:00:00.000', '2026-09-01 08:00:00.000'
FROM seq;

INSERT IGNORE INTO user_credentials (user_id, password_hash, password_algorithm, password_changed_at)
WITH RECURSIVE seq AS (
  SELECT 201 AS n
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 500
)
SELECT 3000 + n, (SELECT password_hash FROM user_credentials WHERE user_id = 18),
  (SELECT password_algorithm FROM user_credentials WHERE user_id = 18), '2026-09-01 09:00:00.000'
FROM seq;

-- 每次压测前重置开课班 509
DELETE FROM course_enrollments WHERE offering_id = 509;
UPDATE course_offerings SET enrolled_count = 0 WHERE id = 509;
