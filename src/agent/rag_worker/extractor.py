import os
import re
import json
import logging

from src.agent.llm.llm_node import model

logger = logging.getLogger(__name__)

# ---------- 正则 ----------
DOC_NO_RE = re.compile(
    r"([\u4e00-\u9fa5]{1,10}[字发]?\s*[〔\[（(]\s*\d{4}\s*[〕\]）)]\s*\d{1,4}\s*号)"
)
DATE_RE = re.compile(r"(\d{4})\s*[年\-/]\s*(\d{1,2})\s*[月\-/]\s*(\d{1,2})\s*日?")
EFFECTIVE_RE = re.compile(
    r"自\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*起"
)


def extract_document_no(text: str):
    m = DOC_NO_RE.search(text)
    return m.group(1).strip() if m else None


def extract_published_at(text: str):
    m = DATE_RE.search(text[:1500])
    if m:
        y, mo, d = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return None


def extract_effective_from(text: str):
    m = EFFECTIVE_RE.search(text)
    if m:
        y, mo, d = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return None


def extract_title(file_name: str, text: str):
    name = os.path.splitext(file_name)[0].strip()
    if name and len(name) > 2:
        return name
    for line in text.splitlines()[:10]:
        line = line.strip()
        if 4 <= len(line) <= 60 and not re.search(r"[。，；：！？]", line):
            return line
    return name or "未命名文档"


# ---------- LLM 元数据提取 ----------
# ★ 分类（category_code）不在这里产出：它由管理员在入库接口里人工指定，
#   已随 categoryCode 参数落到 ingest_service。LLM 只负责从正文里提炼
#   「人看一眼也很难比它更准」的字段（标题、文号、日期）。
DOC_META_PROMPT = """你是一个知识库文档分析助手。请阅读文档内容，提取元数据。

## 文档信息
文件名：{file_name}
文档内容（可能被截断）：
{content}

## 输出要求
只返回一个 JSON 对象，不要有任何其他文字：
{{
  "title": "文档标题（从内容中提炼，比文件名更准确）",
  "summary": "1~3 句话摘要，不超过 150 字",
  "keywords": ["关键词1", "关键词2"],
  "document_no": "文号，如 校学字〔2026〕18号，找不到填 null",
  "published_at": "发布日期 YYYY-MM-DD，找不到填 null",
  "effective_from": "生效日期 YYYY-MM-DD，找不到填 null"
}}

## 约束
- 日期格式统一 YYYY-MM-DD
- 不确定的字段填 null，不要编造
"""


def _message_text(response) -> str:
    """从 LangChain 消息对象里取纯文本。

    ★ 必须是 `.content`：`model` 是 langchain_deepseek.ChatDeepSeek，
      `invoke()` 返回 `AIMessage`，**没有** OpenAI 原生 SDK 的 `.choices`。
      按 `.choices[0].message.content` 取会直接 AttributeError
      （09-21 入库失败的现场）。content 偶尔是分块列表，一并兼容。
    """
    content = getattr(response, "content", None)
    if content is None:
        raise ValueError(
            f"LLM 返回对象没有 content 字段（{type(response).__name__}），"
            "请确认调用的是 LangChain 模型而非原生 OpenAI 客户端"
        )
    if isinstance(content, list):  # 多模态/分块消息
        content = "".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in content
        )
    return str(content)


def _loads_json_object(raw: str) -> dict:
    """把模型返回的 JSON 正文解析成 dict，容忍 markdown 围栏和前后杂字。"""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[A-Za-z0-9_-]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise
        return json.loads(m.group(0))


def llm_extract_meta(llm_client, file_name: str, text: str) -> dict:
    """一次 LLM 调用拿到标题/摘要/文号/日期。

    ★ 不含分类：分类由调用方（管理员）人工指定，不要在这里引入任何
      category 相关字段或兜底逻辑。
    ★ llm_client 传空时退回模块级 model（离线自测就是靠 patch 全局 model 来替换的）。
    """
    prompt = DOC_META_PROMPT.format(
        file_name=file_name,
        content=text[:4000],
    )

    llm = llm_client if llm_client is not None else model

    # 打 internal 标签：RAG 抽取是后台任务，输出是 JSON，绝不能混进对话流
    response = llm.invoke(prompt, config={"tags": ["internal"]})

    raw = _message_text(response).strip()
    if not raw:
        raise ValueError("LLM 元数据抽取返回空内容")
    result = _loads_json_object(raw)
    if not isinstance(result, dict):
        raise ValueError(f"LLM 元数据抽取返回非对象: {type(result)!r}")

    # 分类是人工的，万一模型自作主张带了，直接丢掉，避免后续误用
    result.pop("category_code", None)
    result.pop("confidence", None)
    result.pop("reason", None)
    return result