"""CampusFlowChatDeepSeek：给 ChatDeepSeek 补两块它没做对的事。

为什么要有这个子类（2026-10-07 视觉探针 `_vision_probe.py` 实测坐实，勿凭印象改）：

1. **图像工具结果被拍扁成字符串** —— read_file 读图片在 deepagents 0.7.14 里返回的是
   多模态 ToolMessage（content_blocks=[{"type": "image", "base64": ...}]），langchain 转换层
   会把它转成 OpenAI 格式的 content **list**（[{"type": "image_url", ...}]）；但
   `ChatDeepSeek._get_request_payload`（langchain_deepseek/chat_models.py:272-274）把
   role=tool 的 list content **整体 json.dumps 成纯字符串**再发出去 —— 网关收到的是一段
   含 base64 的 JSON 文本，模型根本收不到图像部件。探针 T3(走 ChatDeepSeek)=400/看不见，
   T4(绕开直接用 openai 客户端发 list)=200 且模型准确描述了图片，坐实卡点在这层序列化。

2. **thinking 模式不回传 reasoning_content** —— 网关对带 tool_calls 的 assistant 消息
   强制要求回传 reasoning_content（缺了直接 400："The `reasoning_content` in the thinking
   mode must be passed back"）。langchain_deepseek 只把模型返回的 reasoning_content 存进
   additional_kwargs，序列化请求时**不带回去**。生产默认 DEFAULT_REASONING_EFFORT=none
   （思考关）一直掩盖着这个问题；思考等级一开 + 工具调用多轮就会炸。

两处都在 `_get_request_payload` 一个出口修：
- tool 消息：content 若是 json.loads 出来的 list 且**含图像块** → 还原成 list（其余保持
  原 dumps 行为不动 —— 那个 dumps 对纯文本 tool 结果可能是有意为之，别扩大化）；
- assistant 消息：仅当**思考开启**（reasoning_effort 不属于 {None, "none"}）时，把
  LangChain 消息 additional_kwargs 里的 reasoning_content 补回请求体。思考关时一个字段
  都不加 —— 生产默认路径（effort=none）已在线上跑通，零行为变化。

构造入口仍在 llm_node（项目唯一出口），本模块只提供类。
"""
import json
import logging

from langchain_core.messages import AIMessage, BaseMessage, convert_to_messages
from langchain_deepseek import ChatDeepSeek

logger = logging.getLogger(__name__)

#: 思考关闭的枚举值 —— 网关语义：none = 不思考（见 llm_node.REASONING_ALIASES 的 off→none）
_THINKING_OFF = {None, "none"}


def _has_image_block(block) -> bool:
    """OpenAI 格式内容块里是否含图像部件。

    覆盖两种形态：langchain 原生 {"type": "image", "base64": ...}（转换前的形态不会
    出现在 wire 上，防御性兼容）与 OpenAI 格式 {"type": "image_url", "image_url": {...}}。
    """
    if not isinstance(block, dict):
        return False
    if block.get("type") in ("image", "image_url"):
        return True
    return isinstance(block.get("image_url"), dict)


class CampusFlowChatDeepSeek(ChatDeepSeek):
    """修复 tool 消息图像块序列化 + thinking 模式 reasoning_content 回传。"""

    def _get_request_payload(self, input_, *, stop=None, **kwargs):
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)
        wire_msgs = payload.get("messages") or []
        # wire 消息与 LangChain 消息逐条一一对应（每条输入恰好转出一条 wire 消息），
        # 用 zip 对齐；长度不一致（理论不该发生）时宁可少修也不错位。
        lc_msgs: list[BaseMessage] = convert_to_messages(input_)

        for wire, lc in zip(wire_msgs, lc_msgs):
            role = wire.get("role")

            # 修复 1：tool 消息里的图像块还原成 list（跳过父类的 json.dumps）
            if role == "tool":
                content = wire.get("content")
                if isinstance(content, str) and content.lstrip().startswith("["):
                    try:
                        parsed = json.loads(content)
                    except (json.JSONDecodeError, ValueError):
                        parsed = None
                    if isinstance(parsed, list) and any(map(_has_image_block, parsed)):
                        wire["content"] = parsed

            # 修复 2：思考开启时回传 reasoning_content
            elif role == "assistant" and self.reasoning_effort not in _THINKING_OFF:
                if isinstance(lc, AIMessage):
                    rc = (lc.additional_kwargs or {}).get("reasoning_content")
                    if rc and not wire.get("reasoning_content"):
                        wire["reasoning_content"] = rc

        return payload
