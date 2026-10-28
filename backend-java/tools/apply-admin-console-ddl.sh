#!/bin/sh
# 把管理后台补齐所需的 DDL 应用到 MySQL。
#
# 为什么要有这个脚本、而不是让人手动跑 SQL：
#   · 本工程没有启用 Flyway（application.yml 里 flyway 段是注释掉的），DDL 全靠手工，
#     手工就意味着「换台机器忘了跑哪几个文件」；
#   · service/src/main/resources/db/ 下两个文件的**幂等性不一样**：
#     2026-09-23-admin-console.sql          —— CREATE TABLE IF NOT EXISTS + 种子，可反复跑；
#     2026-09-23-users-admin-columns.sql    —— 纯 ALTER，跑第二遍报 Duplicate column name。
#   所以由脚本先查 information_schema 判断该不该跑那个 ALTER。
#
# 用法：
#   sh tools/apply-admin-console-ddl.sh                 # 用 application.yml 里的默认连接
#   MYSQL_HOST=... MYSQL_USER=... MYSQL_PASSWORD=... sh tools/apply-admin-console-ddl.sh
#
# ⚠️ 连接信息默认值抄自 service/src/main/resources/application.yml（本地开发库）。
#    生产环境必须显式传参，别指望这里有对的默认值。
set -e

MYSQL_BIN="${MYSQL_BIN:-/c/Program Files/MySQL/MySQL Server 8.0/bin/mysql}"
HOST="${MYSQL_HOST:-192.168.150.100}"
PORT="${MYSQL_PORT:-3306}"
USER="${MYSQL_USER:-root}"
PASS="${MYSQL_PASSWORD:-123}"
DB="${MYSQL_DATABASE:-campus_flow}"

HERE=$(cd "$(dirname "$0")/.." && pwd)
SQL_DIR="$HERE/service/src/main/resources/db"

run_sql_file() {
  "$MYSQL_BIN" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" --default-character-set=utf8mb4 "$DB" < "$1"
}

query() {
  # 显式带库名：-e 里不带库会报 «No database selected»（1071 类错误里最容易看错的一个）
  "$MYSQL_BIN" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" -N -B -D"$DB" -e "$1"
}

echo "→ 目标：$USER@$HOST:$PORT/$DB"

# ⓪ 修复早期版本漏掉的 roles.role_key 唯一键。
#    没有它，下面的 ON DUPLICATE KEY UPDATE 种子每跑一次就多插 4 行同名角色，且不报错 ——
#    「角色体系」里静静地列出两组一模一样的角色，谁也不会去怀疑是表结构问题。
#    放在种子之前跑：先清重、再补键、最后才灌种子。
HAS_UQ=$(query "SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema='$DB' AND table_name='roles' AND index_name='uq_roles_role_key'")
if [ "$HAS_UQ" = "0" ] && [ "$(query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB' AND table_name='roles'")" = "1" ]; then
  query "DELETE r FROM roles r
         JOIN (SELECT role_key, MIN(id) AS keep_id FROM roles GROUP BY role_key) k
           ON r.role_key = k.role_key AND r.id <> k.keep_id"
  query "ALTER TABLE roles ADD UNIQUE KEY uq_roles_role_key (role_key)"
  echo "  ✓ roles.role_key 唯一键已补上，并清掉了重复种子行"
fi

# ① 建表 + 种子：本身幂等，每次都跑（新增角色/权限时靠它补齐）
run_sql_file "$SQL_DIR/2026-09-23-admin-console.sql"
echo "  ✓ 表结构（roles / role_permissions / user_roles / content_reviews）与种子已确保存在"

# ② users 加列：只在 status 列缺失时执行
HAS_STATUS=$(query "SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema='$DB' AND table_name='users' AND column_name='status'")

if [ "$HAS_STATUS" = "0" ]; then
  run_sql_file "$SQL_DIR/2026-09-23-users-admin-columns.sql"
  echo "  ✓ users 已补 status / last_login_ip / network / identity_note"
else
  echo "  · users 的管理端字段已存在，跳过 ALTER"
fi

# ③ 权限矩阵种子：只在 role_permissions 空表时灌默认值。
#    有行就不碰 —— 矩阵是管理员能在界面上改的数据，重灌等于悄悄回滚人家的配置。
HAS_MATRIX=$(query "SELECT COUNT(*) FROM role_permissions")
if [ "$HAS_MATRIX" = "0" ]; then
  run_sql_file "$SQL_DIR/2026-09-23-role-permissions-seed.sql"
  echo "  ✓ 权限矩阵已灌入默认授权（$SQL_DIR/2026-09-23-role-permissions-seed.sql）"
else
  echo "  · 权限矩阵已有 $HAS_MATRIX 行，保留现状（想恢复出厂设置：DELETE FROM role_permissions 后重跑）"
fi

# ④ content_reviews 补 citation_ids：只在列缺失时执行。
#    处置接口的请求体里带这个字段，没有列就等于收下就丢 —— 而且丢得毫无痕迹。
HAS_CITATION_IDS=$(query "SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema='$DB' AND table_name='content_reviews' AND column_name='citation_ids'")
if [ "$HAS_CITATION_IDS" = "0" ]; then
  run_sql_file "$SQL_DIR/2026-09-23-content-reviews-citation-ids.sql"
  echo "  ✓ content_reviews 已补 citation_ids"
else
  echo "  · content_reviews.citation_ids 已存在，跳过 ALTER"
fi

echo "→ 完成。校验："
query "SELECT (SELECT COUNT(*) FROM roles) AS roles,
              (SELECT COUNT(*) FROM role_permissions) AS matrix_rows,
              (SELECT COUNT(*) FROM user_roles) AS assigned_seats,
              (SELECT COUNT(*) FROM content_reviews) AS review_tickets"
