from typing import TypedDict

MAX_ROUNDS = 2          # planner 轮次上限（含首次）
MAX_SUBTASKS = 3
CONFIDENCE_FLOOR = 0.6

class Claim(TypedDict):
    subject: str        # "2026 考研网上预报名"
    predicate: str      # "起止时间"
    value: str          # "2025-10-09 ~ 2025-10-12"
    source: str         # 知识分类名 + 文档 id/名；查不到留 ""
    confidence: float

class Finding(TypedDict):
    role: str
    sub_question: str
    claims: list[Claim]
    notes: str

class SubTask(TypedDict):
    role: str           # policy / academic / workflow / research（不带 _node）
    sub_question: str   # 必须自包含，角色看不到对话历史

class Plan(TypedDict):
    mode: str           # "direct" | "collaborate"
    direct_node: str    # direct 时用："common_agent_node" | "workflow_agent_node"
    subtasks: list[SubTask]

def _k(c: Claim) -> tuple[str, str]:
    return (c["subject"].strip().lower(), c["predicate"].strip().lower())

def merge_findings(left: list[Finding], right: list[Finding]) -> list[Finding]:
    """Reducer —— 会被反复调用，必须幂等。按 (role, sub_question) 覆盖而非跳过：
    "跳过重复"会让补派后拿回的新证据被丢掉，gate 永远判不足。"""
    out = {(f["role"], f["sub_question"]): f for f in left}
    for f in right:
        out[(f["role"], f["sub_question"])] = f
    return list(out.values())

def evaluate_findings(findings: list[Finding], plan: list[SubTask]) -> dict:
    """纯代码判据。collect_node 的 gate 与 synthesis 的自查清单共用这一份，
    绝不允许出现第二份实现（两处判据漂移 = 线上最难查的一类 bug）。"""
    answered, no_source, low_conf = set(), [], []
    table: dict[tuple[str, str], set[str]] = {}
    for f in findings:
        answered.add(f["sub_question"])
        for c in f.get("claims") or []:
            if not (c.get("source") or "").strip():
                no_source.append(f"{c['subject']}/{c['predicate']}")
            if (c.get("confidence") or 0) < CONFIDENCE_FLOOR:
                low_conf.append(f"{c['subject']}/{c['predicate']}")
            table.setdefault(_k(c), set()).add((c.get("value") or "").strip())
    conflicts = [{"subject": k[0], "predicate": k[1], "values": sorted(v)}
                 for k, v in table.items() if len(v) > 1]
    gaps = [st for st in plan if st["sub_question"] not in answered]
    return {"ok": not gaps and not conflicts, "gaps": gaps, "conflicts": conflicts,
            "no_source": no_source, "low_confidence": low_conf}
