"""conflict_scan 离线自测（不连 DB / 不发请求）。

背景：仓库历史离线自测文件在 2026-10-07 实测已全部丢失，本文件重新立一份，
覆盖 conflict_scan 的纯函数层 —— 规则匹配、LLM 输出校验（防幻觉）、提示词占位符。
落库与 Chroma/LLM 的集成路径靠 run_ingest 的降级包裹兜底，不在离线自测范围。

运行：python _conflict_scan_selftest.py（任何断言失败抛 AssertionError）
"""

import os
import sys

# conflict_scan → extractor → llm_node 的导入链会在模块级构造 LLM 客户端
# （只校验 env 不发请求）。离线自测补一个假 key 让构造通过，测试本身不碰网络。
os.environ.setdefault("DEEPSEEK_API_KEY", "offline-selftest")

from src.agent.rag_worker.conflict_scan import (
    RULE_TITLE_SIMILARITY,
    DOC_CONFLICT_PROMPT,
    build_old_content,
    find_rule_conflicts,
    normalize_title,
    validate_llm_conflicts,
)

PASS = 0


def ok(name: str, cond: bool, detail: str = ""):
    global PASS
    assert cond, f"[FAIL] {name} {detail}"
    PASS += 1
    print(f"  ok  {name}")


# ---------- normalize_title ----------
print("== normalize_title ==")
ok("去空白", normalize_title(" 学生 宿舍\n管理规定 ") == "学生宿舍管理规定")
ok("空值", normalize_title(None) == "")

# ---------- find_rule_conflicts ----------
print("== find_rule_conflicts ==")
existing = [
    {"id": 5, "title": "学生宿舍管理规定", "document_no": "校学字〔2025〕3号"},
    {"id": 6, "title": "学生宿舍管理规定（2025版）", "document_no": None},
    {"id": 7, "title": "图书馆借阅规则", "document_no": "校图字〔2024〕9号"},
    {"id": 8, "title": "坏数据", "document_no": None},
]

r = find_rule_conflicts("学生宿舍管理规定", None, existing)
ok("同标题→duplicate_title", [x["conflict_type"] for x in r if x["conflicting_document_id"] == 5] == ["duplicate_title"])
ok("同标题 severity=medium", next(x for x in r if x["conflicting_document_id"] == 5)["severity"] == "medium")

r = find_rule_conflicts("学生宿舍管理规定（2026版）", None, existing)
types6 = [x["conflict_type"] for x in r if x["conflicting_document_id"] == 6]
ok("高相似标题→similar_title", types6 == ["similar_title"], f"got {types6}")
ok("similar_title severity=low", next(x for x in r if x["conflicting_document_id"] == 6)["severity"] == "low")
ok("不同主题不报", all(x["conflicting_document_id"] != 7 for x in r))
# 已知边界（故意放行）：数字差异过大使相似度落在阈值下方，由 LLM 语义层兜
r2 = find_rule_conflicts("学生宿舍管理规定（2026 修订）", None, existing)
ok("低相似标题不误报", all(x["conflicting_document_id"] != 6 for x in r2))

r = find_rule_conflicts("完全不相关的新文件", "校学字〔2025〕3号", existing)
ok("同文号→duplicate_document_no",
   [x["conflict_type"] for x in r] == ["duplicate_document_no"])
ok("同文号不再重复报标题", all(x["conflicting_document_id"] != 5 or x["conflict_type"] == "duplicate_document_no" for x in r))

ok("无文档→空", find_rule_conflicts("任意", None, []) == [])
ok("坏行跳过不炸", find_rule_conflicts("学生宿舍管理规定", None, [{"id": "x", "title": 1}, {"title": "学生宿舍管理规定"}]) != None)
r = find_rule_conflicts(None, None, existing)
ok("新文档无标题时不误报", all(x["conflicting_document_id"] != 7 for x in r))
ok("双方无文号不报文号冲突", find_rule_conflicts("新标题", None, [{"id": 9, "title": "另一标题", "document_no": None}]) == [])
ok("相似度阈值方向", RULE_TITLE_SIMILARITY >= 0.8)

# ---------- validate_llm_conflicts ----------
print("== validate_llm_conflicts ==")
valid_ids = {5, 7}

r = validate_llm_conflicts({"conflicts": [
    {"old_document_id": 5, "field": "门诊报销比例", "new_value": "85%",
     "old_value": "70%", "severity": "high", "description": "比例矛盾"},
]}, valid_ids)
ok("合法条目保留", len(r) == 1 and r[0]["conflict_type"] == "value_discrepancy"
   and r[0]["severity"] == "high")

r = validate_llm_conflicts({"conflicts": [
    {"old_document_id": 999, "field": "x", "description": "编造的文档"},
    {"old_document_id": "abc", "description": "id 非数字"},
    {"old_document_id": 7},  # 缺 description → 用字段拼兜底
    {"field": "x", "description": "连 id 都没有"},
    "不是字典",
]}, valid_ids)
ok("幻觉 id / 坏形状丢弃", len(r) == 1 and r[0]["conflicting_document_id"] == 7)
ok("缺 description 兜底拼接", "「" in r[0]["description"] and "#7" in r[0]["description"])

r = validate_llm_conflicts({"conflicts": [
    {"old_document_id": 5, "severity": "critical", "description": "非法 severity"},
]}, valid_ids)
ok("severity 收敛进 CHECK 枚举", r[0]["severity"] == "medium")

ok("空输入", validate_llm_conflicts(None, valid_ids) == []
   and validate_llm_conflicts({}, valid_ids) == []
   and validate_llm_conflicts({"conflicts": []}, valid_ids) == []
   and validate_llm_conflicts({"conflicts": "不是列表"}, valid_ids) == [])
ok("无旧文档集合→全丢", validate_llm_conflicts(
    {"conflicts": [{"old_document_id": 5, "description": "x"}]}, set()) == [])

# ---------- build_old_content ----------
print("== build_old_content ==")
content, ids = build_old_content([
    {"content": "甲内容", "metadata": {"documentId": 5}},
    {"content": "乙内容", "metadata": {"documentId": "7"}},
    {"content": "坏块", "metadata": {}},
    {"content": "丙内容", "metadata": {"documentId": 9}},
])
ok("id 集合含数字与字符串形式", ids == {5, 7, 9})
ok("标注进正文", "documentId=5" in content and "甲内容" in content)

# ---------- 提示词占位符 ----------
print("== DOC_CONFLICT_PROMPT ==")
filled = DOC_CONFLICT_PROMPT.format(new_content="新文档", old_content="旧文档")
ok("占位符可格式化", "新文档" in filled and "旧文档" in filled)
ok("输出契约在提示词里", '"conflicts"' in DOC_CONFLICT_PROMPT
   and "old_document_id" in DOC_CONFLICT_PROMPT)

print(f"\n全部通过：{PASS} 项断言")
sys.exit(0)
