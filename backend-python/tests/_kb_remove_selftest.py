# -*- coding: utf-8 -*-
"""知识库「移出 / 已移出列表」契约守卫（离线 AST 自测，不连任何库）。

背景（2026-10-15）：knowledge_documents.status 的库枚举里**没有** 'removed'，
移出判据唯一 = deleted_at IS NOT NULL。这批守卫把三条纪律钉死，防回潮：

  1. ingest_service 不得再出现 REMOVED 常量或 status='removed' 类写入；
  2. repository.mark_document_removed 只许写 deleted_at，不许碰 status；
  3. 路由 GET /documents/removed 必须声明在 GET /documents/{document_id}
     之前（FastAPI 按声明顺序匹配，反了会把 "removed" 拿去解析 int → 422），
     且 remove 响应契约 = {"id": ...}。

🔴 守卫查 AST 结构，不 grep 文本（'removed' 这个词必然出现在解释注释里）。
用 .venv/Scripts/python.exe 或任意 3.10+ 运行（在 backend-python/ 下）：
    python -m tests._kb_remove_selftest
"""

import ast
import os
import sys

# 本文件在 tests/ 下，仓库根（backend-python/）是上一级
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROUTER = os.path.join(ROOT, "src", "api", "knowledge_router.py")
SVC = os.path.join(ROOT, "src", "agent", "rag_worker", "ingest_service.py")
REPO = os.path.join(ROOT, "src", "agent", "rag_worker", "repository.py")

FAILS: list = []


def check(name: str, ok: bool, why: str = ""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"  —— {why}" if (why and not ok) else ""))
    if not ok:
        FAILS.append(name)


def parse(path: str) -> ast.AST:
    with open(path, "r", encoding="utf-8") as f:
        return ast.parse(f.read(), filename=path)


router_tree = parse(ROUTER)
svc_tree = parse(SVC)
repo_tree = parse(REPO)


def find_fn(tree: ast.AST, name: str):
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    return None


def is_str(node: ast.AST, value: str) -> bool:
    return (isinstance(node, ast.Constant) and isinstance(node.value, str)
            and node.value == value)


# ---------------------------------------------------------------- 1. 状态枚举纪律
# ingest_service 里不得定义 REMOVED 常量、不得出现 status='removed' 的写法
removed_names = [n for n in svc_tree.body
                 if isinstance(n, ast.Assign)
                 and any(isinstance(t, ast.Name) and t.id == "REMOVED" for t in n.targets)]
check("ingest_service 不再定义 REMOVED 常量", not removed_names)

# 全模块找 status=<字面量 'removed'> 或与 REMOVED 的比较（读/写都算回潮）
bad_status = []
for node in ast.walk(svc_tree):
    if isinstance(node, ast.keyword) and node.arg == "status" and is_str(node.value, "removed"):
        bad_status.append(f"values(status='removed') @line {node.value.lineno}")
    if isinstance(node, ast.Compare):
        for cmp in [node.left, *node.comparators]:
            if is_str(cmp, "removed") and any(
                    isinstance(op, ast.Eq) for op in node.ops):
                side = [n for n in ast.walk(node) if isinstance(n, ast.Name)]
                if side:
                    bad_status.append(f"== 'removed' 比较 @line {node.lineno}")
check("ingest_service 无 status='removed' 读写", not bad_status, "; ".join(bad_status))

# repository 同样不得写 status='removed'
bad_repo_status = []
for node in ast.walk(repo_tree):
    if isinstance(node, ast.keyword) and node.arg == "status" and is_str(node.value, "removed"):
        bad_repo_status.append(f"@line {node.value.lineno}")
check("repository 无 status='removed' 写入", not bad_repo_status, "; ".join(bad_repo_status))

# ---------------------------------------------------------------- 2. mark_document_removed
mark = find_fn(repo_tree, "mark_document_removed")
check("repository.mark_document_removed 存在", mark is not None)
if mark is not None:
    has_deleted_at = any(
        isinstance(kw, ast.keyword) and kw.arg == "deleted_at"
        for node in ast.walk(mark)
        if isinstance(node, ast.Call)
        for kw in node.keywords)
    has_status = any(
        isinstance(kw, ast.keyword) and kw.arg == "status"
        for node in ast.walk(mark)
        if isinstance(node, ast.Call)
        for kw in node.keywords)
    check("mark_document_removed 写 deleted_at", has_deleted_at)
    check("mark_document_removed 不碰 status", not has_status)

# ---------------------------------------------------------------- 3. remove_document 契约
rm = find_fn(svc_tree, "remove_document")
check("ingest_service.remove_document 存在", rm is not None)
if rm is not None:
    # 判据必须是 deleted_at is not None（而不是 status 比较）
    deleted_check = any(
        isinstance(cmp, ast.Attribute) and cmp.attr == "deleted_at"
        for node in ast.walk(rm)
        if isinstance(node, ast.Compare)
        for cmp in [node.left, *node.comparators])
    check("remove_document 幂等判据用 deleted_at", deleted_check)
    # 两个出口的返回 dict 都必须含 "id" 键、且不含已废弃的 removed/status 键
    dicts = [n.value for n in ast.walk(rm)
             if isinstance(n, ast.Return) and isinstance(n.value, ast.Dict)]
    ok_id = bool(dicts) and all(
        any(isinstance(k, ast.Constant) and k.value == "id" for k in d.keys)
        for d in dicts)
    ok_legacy = all(
        not any(isinstance(k, ast.Constant) and k.value in ("removed", "status")
                for k in d.keys)
        for d in dicts)
    check(f"remove_document 返回契约 {{'id': ...}}（{len(dicts)} 个出口）", ok_id)
    check("remove_document 不再回传 removed/status 键", ok_legacy)
    # 删向量失败必须先于写 deleted_at（找 run_in_executor(delete_document) 与
    # mark_document_removed 的语句先后顺序）
    seq = []
    for node in ast.walk(rm):
        if isinstance(node, ast.Call):
            fn = node.func
            name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", "")
            if name == "mark_document_removed":
                seq.append(("mark", node.lineno))
            if isinstance(fn, ast.Attribute) and fn.attr == "run_in_executor":
                args = node.args
                # 形如 run_in_executor(None, VectorStore.delete_document, code, doc_id)
                if (len(args) >= 2 and isinstance(args[1], ast.Attribute)
                        and args[1].attr == "delete_document"
                        and isinstance(args[1].value, ast.Name)
                        and args[1].value.id == "VectorStore"):
                    seq.append(("vector", node.lineno))
    order_ok = (len(seq) == 2 and seq[0][0] == "vector" and seq[1][0] == "mark")
    seq.sort(key=lambda t: t[1])  # ast.walk 不保证源码顺序，按行号排
    order_ok = (len(seq) == 2 and seq[0][0] == "vector" and seq[1][0] == "mark")
    check("先删向量、后打 deleted_at（顺序钉死）", order_ok, str(seq))

# ---------------------------------------------------------------- 4. 路由声明顺序
route_lines = []
for node in ast.walk(router_tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        for dec in node.decorator_list:
            if (isinstance(dec, ast.Call)
                    and isinstance(dec.func, ast.Attribute)
                    and isinstance(dec.func.value, ast.Name)
                    and dec.func.value.id == "knowledge_router"
                    and dec.args and isinstance(dec.args[0], ast.Constant)):
                route_lines.append((dec.args[0].value, dec.lineno))
removed_route = [ln for path_, ln in route_lines if path_ == "/documents/removed"]
# 重新精确取 GET /documents/{document_id} 的行号
get_detail_lines = []
for node in ast.walk(router_tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        for dec in node.decorator_list:
            if (isinstance(dec, ast.Call)
                    and isinstance(dec.func, ast.Attribute) and dec.func.attr == "get"
                    and dec.args and isinstance(dec.args[0], ast.Constant)
                    and dec.args[0].value == "/documents/{document_id}"):
                get_detail_lines.append(dec.lineno)
check("路由 GET /documents/removed 已声明", bool(removed_route))
if removed_route and get_detail_lines:
    check("GET /documents/removed 声明在 /documents/{document_id} 之前",
          removed_route[0] < min(get_detail_lines),
          f"removed@{removed_route[0]} vs detail@{min(get_detail_lines)}")

removed_fn = find_fn(router_tree, "removed_documents")
check("路由处理函数 removed_documents 存在", removed_fn is not None)
if removed_fn is not None:
    params = {a.arg for a in removed_fn.args.args}
    check("removed 列表带 query/category/page/page_size",
          {"query", "category", "page", "page_size"} <= params, str(params))
    # Depends(...) 在 user_id 的**默认值**里（本仓路由惯例：user_id 不带类型注解）
    has_auth = any(
        isinstance(d, ast.Call)
        and isinstance(d.func, ast.Name)
        and d.func.id == "Depends"
        for d in removed_fn.args.defaults)
    check("removed 列表挂了鉴权 Depends(get_current_user_id)", has_auth)

# ---------------------------------------------------------------- 5. 已移出查询的过滤条件
where_fn = None
for node in ast.walk(repo_tree):
    if isinstance(node, ast.FunctionDef) and node.name == "_removed_where":
        where_fn = node
check("repository._removed_where 存在", where_fn is not None)
if where_fn is not None:
    has_deleted = any(
        isinstance(c, ast.Constant) and isinstance(c.value, str)
        and "d.deleted_at IS NOT NULL" in c.value
        for c in ast.walk(where_fn))
    check("已移出过滤基准条件 = deleted_at IS NOT NULL", has_deleted)

print()
if FAILS:
    print(f"✗ {len(FAILS)} 项未过：{FAILS}")
    sys.exit(1)
print("✓ 全部通过")
