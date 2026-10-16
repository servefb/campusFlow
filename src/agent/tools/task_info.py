from langchain_core.tools import tool

from src.db.basic_config import AsyncSessionLocal
from src.repositories.tasks_templates_match import get_tasks_templates_match_to_llm


def _fmt(item: dict) -> str:
    """把一条匹配结果压成几行事实，供模型判断。

    只给"事实"：事项名 / 流程 / 材料 / 建议追问。
    ⚠️ 刻意不出现 template_key、置信度、匹配理由、英文字段名等内部信息——
    模型看到什么就抄什么，这些内容一旦给出就会进用户回答
    （实测：「student-card-reissue，置信度 1.0」「尚缺：reason、photo」都被原样抄过）。
    """
    lines = [f"事项：{item.get('template_name') or '未知事项'}"]
    steps = sorted(item.get("steps") or [], key=lambda s: s.get("step_order") or 0)
    if steps:
        lines.append("流程：" + " → ".join(
            str(s.get("name")) + ("" if s.get("requires_user_action") else "（无需用户操作）")
            for s in steps))
    reqs = item.get("requirements") or []
    lines.append("材料：" + ("、".join(
        f"{r.get('name')}（{'必交' if r.get('is_required') else '选交'}）" for r in reqs)
        or "模板未列出材料清单"))
    if item.get("clarifying_questions"):
        lines.append("建议追问：" + "；".join(str(q) for q in item["clarifying_questions"]))
    return "\n".join(lines)


@tool
async def get_task_info(title: str) -> str:
    """查询、匹配校园办事事项（任务模板）的信息。用户提到具体办事事项——
    例如“学生证补办”“请假申请”“社团活动审批”——无论想了解怎么办、所需材料、
    办理流程，还是查该事项详情，都必须调用此工具。

    Args:
        title: 用户原始查询内容或办事事项名称关键词，用于模糊匹配任务模板。

    Returns:
        匹配到的事项概要：事项名、办理流程、所需材料、建议追问。
    """
    async with AsyncSessionLocal() as session:
        res = await get_tasks_templates_match_to_llm(title, session)

    items = (res.get("data") or {}).get("items") if isinstance(res, dict) else None
    if isinstance(items, dict):  # LLM 可能返回单个对象
        items = [items]
    items = [i for i in (items or []) if isinstance(i, dict)]
    if not items:
        return "未匹配到对应事项。请如实告知用户，并引导其联系相关部门或走人工办理。"
    return "\n\n".join(_fmt(i) for i in items)
