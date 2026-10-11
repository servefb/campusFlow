"""对话历史清洗工具。

问题背景：common_agent 的工具调用序列(AIMessage(tool_calls) + ToolMessage)会
随 checkpointer 完整持久化到外层 state。下一轮取历史时，切片(history[-N:])可能：
  1. 正好从带 tool_calls 的 AIMessage 开始；
  2. 把 tool_calls 和它对应的 ToolMessage 切开；
  3. 工具结果消息混进只用于路由的历史。
这三种情况发给 DeepSeek 都会 400：
  "An assistant message with 'tool_calls' must be followed by tool messages
   responding to each 'tool_call_id'"

所以任何把外层历史喂给 LLM 之前，都必须先过 sanitize_history。
"""
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage, get_buffer_string

import logging
import os

logger = logging.getLogger(__name__)

# ── 跨轮历史窗口（2026-10-08）────────────────────────────────────────
# 问题：sanitize_history 只清洗形状、不做截断，checkpointer 里的历史逐轮累积、
# 每轮全量重发。deepagents 的 summarization 中间件只管**单轮之内**的膨胀
# （触发阈值 = 0.85 × profile.max_input_tokens），跨轮没人管 —— 长会话下每轮
# token 成本与延迟线性上涨（promptCacheKey 省钱不省延迟，且网关缓存前缀
# 有时效/长度上限，超了就是全价重算）。
#
# 方案：最近 HISTORY_KEEP_ROUNDS 轮原文保留；更早的轮次折叠成一条**滚动摘要**
# （存 state 的 history_summary / history_covered，绝不进 messages —— 与 laya
# 警示语同一纪律，否则被 checkpointer 持久化后每轮重发）。摘要每轮以一条
# HumanMessage 拼在历史最前面 —— 消息形态沿用 deepagents summarization 中间件
# 的做法（HumanMessage + 说明文字，生产已在网关上验证可收），不用 SystemMessage
# （DeepSeek 对非开头的 system 消息兼容性没验证过，不能拿整轮对话赌）。
#
# 缓存考量：摘要只在「折叠发生」的轮次变化。为避免前缀缓存每轮失效，折叠按
# 阈值批量进行 —— 超出窗口的轮数攒够 HISTORY_FOLD_ROUNDS 才折叠一次；两次折叠
# 之间上下文只在尾部追加，前缀（system prompt + 摘要 + 旧历史）稳定命中缓存。
#
# ⚠️ history_covered 按 sanitize_history **之后**的列表下标计数。messages 只在
# 尾部追加、sanitize 是确定性映射，所以下标跨轮稳定；若将来改 sanitize_history
# 的映射规则（删消息/改顺序），必须同步迁移已存会话的 history_covered。
HISTORY_KEEP_ROUNDS = int(os.getenv("HISTORY_KEEP_ROUNDS", "12"))
HISTORY_FOLD_ROUNDS = int(os.getenv("HISTORY_FOLD_ROUNDS", "6"))

# 折叠是**辅助步骤**（与"抽元数据等辅助 LLM 步骤只降级不中断"同一纪律）：
# 任何失败都降级成"本轮不折叠"，下轮重试，绝不中断主流程。


def sanitize_history(messages) -> list:
    """去掉 ToolMessage，把带 tool_calls 的 AIMessage 降级为普通文本消息。

    这样历史里不再存在任何 tool_calls，无论怎么切片都是合法序列。
    """
    sanitized = []
    for m in messages:
        if isinstance(m, ToolMessage):
            continue
        if isinstance(m, AIMessage) and getattr(m, "tool_calls", None):
            content = m.content if isinstance(m.content, str) and m.content.strip() else ""
            # 保留模型在调用工具前写的思考文本；没有就放占位，保证角色序列连贯
            sanitized.append(AIMessage(content=content or "(已调用知识检索工具)"))
            continue
        sanitized.append(m)
    return sanitized


def round_attachments(config) -> str:
    """取本轮附件块（**附件的磁盘路径** + 未处理原因），由 conversations_repo 放进 config。

    块里只有路径（09-20 二次定稿：附件一律落盘、只喂路径），没有正文。
    为什么不拼进 state["question"]：那会被节点写成 HumanMessage 并**持久化**
    （checkpointer + 消息表），此后每轮 sanitize_history 都会把它重发给模型；
    历史回放时前端也会多出一坨 JSON。本轮需要时由节点拼上，落 state 前换回干净提问。
    """
    return ((config or {}).get("configurable") or {}).get("attachments") or ""


def round_messages(res_msgs: list, history_len: int, clean_question: str,
                   has_attachments: bool) -> list:
    """切出本轮新增消息；本轮带了附件时，把那条 HumanMessage 换回干净提问。

    附件块只该给模型看**一次**（本轮）。带附件块的那条 HumanMessage 若原样返回，
    就会被 checkpointer 存进 thread、被消息表落库，随后每轮历史重发都得再带着它。
    附件路径另有 Redis 缓存兜底（见 conversations_repo `conv:{thread}:attach`），
    后续轮次会自动补上「历史附件记录」索引（被动式措辞，模型只在问题涉及时才读），
    """
    try:
        idx = max(i for i, m in enumerate(res_msgs) if isinstance(m, HumanMessage))
        msgs = list(res_msgs[idx:])
    except ValueError:  # 理论上不会发生：兜底返回全部新增(去头)
        msgs = list(res_msgs[history_len:])
    if has_attachments and msgs and isinstance(msgs[0], HumanMessage):
        msgs[0] = HumanMessage(content=clean_question)
    return msgs


# ══ 跨轮历史窗口 ══════════════════════════════════════════════════════

def plan_history_window(sanitized: list, covered: int,
                        keep_rounds: int | None = None,
                        fold_rounds: int | None = None) -> tuple[list, list]:
    """把清洗后的历史切成（本轮待折叠段, 保留段）。

    `covered`：历史前缀中已折叠进摘要的消息条数（sanitize 之后的下标，见模块注释）。
    保留段 = 最后 keep_rounds 轮（一轮 = 一条 HumanMessage 起头）的原文；
    待折叠段 = 保留窗口之前、且尚未折叠的轮次 —— 攒够 fold_rounds 轮才真的折叠
    （调用方据此决定要不要调摘要 LLM），没攒够时待折叠段返回空、原样留在上下文里，
    代价只是窗口比 keep_rounds 略宽（最多宽 fold_rounds-1 轮），换来前缀缓存稳定。
    """
    keep_rounds = HISTORY_KEEP_ROUNDS if keep_rounds is None else keep_rounds
    fold_rounds = HISTORY_FOLD_ROUNDS if fold_rounds is None else fold_rounds
    covered = max(0, min(int(covered or 0), len(sanitized)))
    uncovered = sanitized[covered:]
    # 轮的边界 = uncovered 里第 k 条 HumanMessage 的下标（历史已 sanitize，
    # 不含 ToolMessage / tool_calls，任意前缀切分都是合法消息序列）
    human_idx = [i for i, m in enumerate(uncovered) if isinstance(m, HumanMessage)]
    excess = len(human_idx) - keep_rounds
    if excess < fold_rounds:
        return [], uncovered
    cut = human_idx[excess]  # 保留窗口的第一条 = 第 excess 轮的 HumanMessage
    return uncovered[:cut], uncovered[cut:]


def summary_message(summary: str) -> HumanMessage:
    """滚动摘要的消息形态：HumanMessage，拼在模型输入历史的最前面。

    每轮现建、只进本轮模型调用，**不返回进 state**（否则被持久化，回到每轮重发）。
    """
    return HumanMessage(content=(
        "【会话摘要】以下是本会话较早轮次的要点（已折叠出近期上下文，仅供延续对话参考，"
        "不是用户新发的消息）：\n"
        f"{summary}\n"
        "（摘要之后是最近几轮的原始对话。）"
    ))


# 折叠输入的字符上限：这是辅助调用，别让它本身变成一笔大开销。
_FOLD_INPUT_CHAR_CAP = 24000

_FOLD_PROMPT = """你在为一位校园事务助手维护跨轮对话的滚动摘要。下面有【现有摘要】和【新折叠的历史消息】（这些轮次已移出近期上下文，之后只剩这份摘要）。

请把新历史合并进现有摘要，输出一份新的摘要。要求：
1. 保留对后续对话有用的信息：用户的目标与已做的决定、已确认的事实与出处、用户的称呼与偏好、未完成的事项与悬而未决的问题、重要的日期与数字。
2. 不收录：工具返回的原文与内部格式、附件路径清单、寒暄与过程性对话、重复内容。
3. 新旧信息冲突时以新历史为准，并注明发生了变更。
4. 全文不超过 500 字，按要点列出；实在没有可保留的内容就只输出"（无实质内容）"。

【现有摘要】
{old_summary}

【新折叠的历史消息】
{history_text}

直接输出新摘要正文，不要任何前后缀说明。"""


def _clip_history_text(text: str) -> str:
    """超长时保头去中：最早的轮次决定任务起点，最近的轮次离摘要生效期最近。"""
    if len(text) <= _FOLD_INPUT_CHAR_CAP:
        return text
    head_len = _FOLD_INPUT_CHAR_CAP * 2 // 3
    tail_len = _FOLD_INPUT_CHAR_CAP // 3
    return f"{text[:head_len]}\n…（中段因超长截断）…\n{text[-tail_len:]}"


async def fold_history_summary(model, old_summary: str, folded: list) -> str | None:
    """把待折叠轮次合并进滚动摘要（辅助 LLM 调用）。

    成功返回新摘要文本；失败/空返回返回 None，调用方降级为"本轮不折叠"。
    model 由调用方传入（llm_node.model 全局单例，思考关、无 cacheKey ——
    折叠调用不值得占会话缓存前缀）。LangChain 返回取 .content，不是 .choices。
    """
    if not folded:
        return old_summary or None
    history_text = _clip_history_text(get_buffer_string(folded))
    prompt = _FOLD_PROMPT.format(
        old_summary=old_summary or "（暂无，这是第一份摘要）",
        history_text=history_text,
    )
    try:
        resp = await model.ainvoke(prompt)
        text = (getattr(resp, "content", "") or "").strip()
        if not isinstance(text, str) or not text:
            return None
        return text[:2000]  # 防模型跑飞；正常摘要 ≤500 字
    except Exception as e:
        logger.warning("跨轮摘要折叠失败（本轮不折叠，下轮重试）：%s", e)
        return None
