"""模型构造的唯一入口。

⚠️ 这里有一道必须守住的约束：**reasoning_effort 只能发网关认识的值**。

原因（09-20 线上事故复盘）：langchain_openai 的 `reasoning_effort: str | None`
是个**自由字符串字段**，客户端不做任何校验，而且非 None 时会被**无条件**塞进请求体
（langchain_openai/chat_models/base.py:1491，只有 None 走 exclude_if_none 被剔除）。
于是写错一个值，本地毫无察觉，请求一路发到服务端才 422 —— 而此时 SSE 流早就开始了，
异常落在图内部的模型调用里，用户看到的就是"转了半天空流"，不是一条清楚的报错。

事故现场就是默认值写成了 `"balance"`（那是回答偏好的词，不是思考等级）：
    openai.UnprocessableEntityError: 422 reasoning_effort: unknown variant `balance`,
    expected one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`

所以：**所有调用方只管把原始值透传进来，收敛成网关枚举这件事只在 normalize_* 里做一次。**
"""

import logging
import os

from dotenv import load_dotenv

from src.agent.llm.chat_model import CampusFlowChatDeepSeek

load_dotenv()

logger = logging.getLogger(__name__)

MODEL_NAME = "deepseek-flash"

# 模型输入上限（profile），deepagents 用它算 summarization 触发阈值 = 0.85 × 此值。
# ⚠️ 必须与网关的真实上下文窗口对齐：写大了单轮 summarization 永远不触发，
# 超限报错直接落在流内部（又是"转半天空流"式故障）；写小了过早折叠浪费上下文。
# 2026-10-08：仓库 .env / 进程环境 / 用户环境里都没有网关地址与密钥，本机无法实测
# 真实窗口，所以做成环境变量由部署侧按网关规格配置；默认维持历史值 1_000_000。
MAX_INPUT_TOKENS = int(os.getenv("MODEL_MAX_INPUT_TOKENS", "1000000"))

# 网关（deepseek-flash 所在服务）对 reasoning_effort 的严格枚举。
# 来源：上面那段服务端反序列化报错原文，不是猜的。
VALID_REASONING_EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh", "max")

# 约定值 / 历史写法 / 手误写法 → 网关枚举值。
# 前端「深度思考等级」传的是 off / low / high / max（见 src/models/meassage.py 注释），
# 其中 off 在网关里叫 none；其余是兼容历史值，免得又一个"差一点"的值把整轮对话搞挂。
REASONING_ALIASES = {
    "none": "none",
    "off": "none",
    "false": "none",
    "disabled": "none",
    "disable": "none",
    "minimal": "minimal",
    "low": "low",
    "medium": "medium",
    "middle": "medium",
    "normal": "medium",
    "standard": "medium",
    "default": "medium",
    "balance": "medium",  # 旧默认值：曾被当思考等级发出去 → 直接 422
    "balanced": "medium",
    "high": "high",
    "xhigh": "xhigh",
    "extra_high": "xhigh",
    "max": "max",
    "maximum": "max",
    "ultra": "max",
}

# 认不出来时用什么。默认 none = 不额外思考（与原「off」档位语义一致，也最省 token）。
DEFAULT_REASONING_EFFORT = os.getenv("DEFAULT_REASONING_EFFORT", "none")


def normalize_reasoning_effort(value) -> str:
    """把任意来源的思考等级收敛成网关认识的枚举值，认不出就退回默认。

    绝不"猜着发"：这个字段写错的代价是整轮对话失败，而且报错藏在流内部，极难定位。
    """
    if value is None:
        return DEFAULT_REASONING_EFFORT
    if not isinstance(value, str):
        logger.warning("reasoning_effort 类型异常（%r），改用默认值 %s",
                       value, DEFAULT_REASONING_EFFORT)
        return DEFAULT_REASONING_EFFORT
    key = value.strip().lower()
    if not key:
        return DEFAULT_REASONING_EFFORT
    mapped = REASONING_ALIASES.get(key) or (key if key in VALID_REASONING_EFFORTS else None)
    if mapped is None:
        logger.warning("未知的 reasoning_effort=%r，改用默认值 %s",
                       value, DEFAULT_REASONING_EFFORT)
        return DEFAULT_REASONING_EFFORT
    return mapped


def get_model(cacheKey: str, reasoning_effort=None) -> CampusFlowChatDeepSeek:
    effort = normalize_reasoning_effort(reasoning_effort)
    return CampusFlowChatDeepSeek(
        model=MODEL_NAME,
        prompt_cache_options={"cacheKey": cacheKey},  # 核心：同一对话始终用这个值
        temperature=0,
        stream_usage=True,
        reasoning_effort=effort,
        profile={"max_input_tokens": MAX_INPUT_TOKENS},
    )


def get_com_model() -> CampusFlowChatDeepSeek:
    return CampusFlowChatDeepSeek(
        model=MODEL_NAME,
        temperature=0,
        stream_usage=True,
        profile={"max_input_tokens": MAX_INPUT_TOKENS},
    )


def get_structured_model(cacheKey: str) -> CampusFlowChatDeepSeek:
    return get_model(cacheKey, "none")


# 全局单例：进程内只构造一次（路由 / 标题 / 抽取等轻量调用用，不设思考等级）
model = get_com_model()
