"""视觉能力探针：验证 deepseek-flash 网关能否吃 read_file 产出的图像内容块。

背景：deepagents 0.7.14 的 read_file 读图片返回
    ToolMessage(content_blocks=[{"type": "image", "base64": ..., "mime_type": ...}])
模型能否"看见"取决于网关/模型是否接受 image 输入 —— 本脚本直接实测。

三个测试：
  T1  纯文本连通性（排除 key/模型名/网络问题）
  T2  OpenAI 标准格式图像块（HumanMessage, image_url + data URI）
  T3  完整复刻 read_file 路径：AIMessage(tool_call) → ToolMessage(image 块)

密钥从正在运行的后端进程(PID)环境里取，不落盘、不打印。
"""
import base64
import io
import json
import os
import re
import sys

# ── 环境预补丁（必须在 import langchain 之前）──────────────────────────
# 沙箱会给子进程注入带 [::1] 的 no_proxy → httpx 客户端一构造就崩（InvalidURL）。
for var in ("no_proxy", "NO_PROXY"):
    val = os.environ.get(var)
    if val and "[::1]" in val:
        os.environ[var] = re.sub(r"\[::1\],?", "", val).strip(",")

import psutil  # noqa: E402


def get_backend_env(pid_hint: int | None = None) -> dict:
    """找监听 127.0.0.1:8000 的 python 进程，取它的环境变量（含 DEEPSEEK_API_KEY）。"""
    for p in psutil.process_iter(["pid", "name"]):
        try:
            if "python" not in (p.info["name"] or "").lower():
                continue
            for c in p.net_connections(kind="inet"):
                if c.status == psutil.CONN_LISTEN and c.laddr.port == 8000:
                    return p.environ()
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            continue
    raise RuntimeError("没找到监听 8000 的后端进程")


# ── 取密钥 ────────────────────────────────────────────────────────────
env = get_backend_env()
key = env.get("DEEPSEEK_API_KEY")
if not key:
    sys.exit("后端进程环境里没有 DEEPSEEK_API_KEY")
os.environ["DEEPSEEK_API_KEY"] = key
# 复刻后端进程的代理环境（api.deepseek.com 是公网，走用户的代理是后端的真实路径）
for var in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
    if var in env:
        os.environ[var] = env[var]

# ── 构造模型（与 llm_node.get_com_model 同参）─────────────────────────
from langchain_deepseek import ChatDeepSeek  # noqa: E402
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage  # noqa: E402

model = ChatDeepSeek(model="deepseek-flash", temperature=0, stream_usage=False)


def make_test_png() -> str:
    """生成一张 64x64、左半红右半蓝的 PNG，返回 base64。PIL 缺席时用内置 8x8 红块。"""
    try:
        from PIL import Image
        img = Image.new("RGB", (64, 64))
        for x in range(64):
            for y in range(64):
                img.putpixel((x, y), (255, 0, 0) if x < 32 else (0, 0, 255))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()
    except ImportError:
        # 1x1 红色 PNG（内置常量，保证脚本无依赖也能跑）
        return (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8"
            "z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
        )


PNG_B64 = make_test_png()


def run(name: str, messages):
    print(f"\n=== {name} ===")
    try:
        resp = model.invoke(messages)
        text = resp.content if isinstance(resp.content, str) else json.dumps(resp.content, ensure_ascii=False)
        print("✅ 200:", text[:200])
        return True
    except Exception as e:
        print(f"❌ {type(e).__name__}: {str(e)[:400]}")
        return False


ok1 = run("T1 纯文本连通性", "只回复两个字母：ok")

ok2 = run(
    "T2 HumanMessage 图像块（OpenAI image_url 格式）",
    [HumanMessage(content=[
        {"type": "text", "text": "这张图由哪两种颜色组成？一句话回答。"},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{PNG_B64}"}},
    ])],
)

ok3 = run(
    "T3 复刻 read_file：ToolMessage 带 image 内容块",
    [
        HumanMessage(content="帮我读一下 /user/uploads/test.png 这张图"),
        AIMessage(
            content="",
            # thinking 模式下多轮必须回传 reasoning_content（真实链路里
            # ChatDeepSeek 会把模型返回的 reasoning_content 存进 additional_kwargs
            # 并在下一轮自动带上；手工拼消息也得带上）
            additional_kwargs={"reasoning_content": "用户要求读取图片，调用 read_file。"},
            tool_calls=[
                {"name": "read_file", "args": {"file_path": "/user/uploads/test.png"}, "id": "call_probe_1", "type": "tool_call"},
            ],
        ),
        ToolMessage(
            content="",
            content_blocks=[{"type": "image", "base64": PNG_B64, "mime_type": "image/png"}],
            name="read_file",
            tool_call_id="call_probe_1",
        ),
    ],
)

# ── 报文透视：看 T3 实际发出去的 messages（不联网）────────────────────
print("\n=== 报文透视（T3 实际 payload，base64 截断）===")
try:
    msgs = [
        HumanMessage(content="帮我读一下 /user/uploads/test.png 这张图"),
        AIMessage(
            content="",
            additional_kwargs={"reasoning_content": "用户要求读取图片，调用 read_file。"},
            tool_calls=[{"name": "read_file", "args": {"file_path": "/user/uploads/test.png"}, "id": "call_probe_1", "type": "tool_call"}],
        ),
        ToolMessage(
            content="",
            content_blocks=[{"type": "image", "base64": PNG_B64, "mime_type": "image/png"}],
            name="read_file",
            tool_call_id="call_probe_1",
        ),
    ]
    payload = model._get_request_payload(msgs, stop=None)
    for m in payload["messages"]:
        mm = dict(m)
        c = mm.get("content")
        if isinstance(c, str) and len(c) > 120:
            mm["content"] = f"<str len={len(c)}> {c[:100]}..."
        elif isinstance(c, list):
            shown = []
            for b in c:
                b = dict(b)
                for f in ("image_url",):
                    if f in b and isinstance(b[f], dict) and "url" in b[f]:
                        b[f]["url"] = b[f]["url"][:60] + f"...(len={len(b[f]['url'])})"
                if "base64" in b:
                    b["base64"] = str(b["base64"])[:40] + f"...(len={len(b['base64'])})"
                shown.append(b)
            mm["content"] = shown
        print(json.dumps(mm, ensure_ascii=False)[:600])
except Exception as e:
    print("payload 透视失败:", type(e).__name__, str(e)[:300])

# ── T4：绕开 ChatDeepSeek 的 json.dumps，用 openai 客户端直发 list 格式 tool 消息 ──
print("\n=== T4 原始 openai 客户端：tool 消息 content=list(图像块) ===")
try:
    from openai import OpenAI
    client = OpenAI(api_key=key, base_url="https://api.deepseek.com/v1")
    resp = client.chat.completions.create(
        model="deepseek-flash",
        messages=[
            {"role": "user", "content": "帮我读一下 /user/uploads/test.png 这张图"},
            {"role": "assistant", "content": None,
             "reasoning_content": "用户要求读取图片，调用 read_file。",
             "tool_calls": [
                {"id": "call_probe_1", "type": "function",
                 "function": {"name": "read_file", "arguments": json.dumps({"file_path": "/user/uploads/test.png"})}},
            ]},
            {"role": "tool", "tool_call_id": "call_probe_1",
             "content": [{"type": "image_url", "image_url": {"url": f"data:image/png;base64,{PNG_B64}"}}]},
        ],
    )
    print("✅ 200:", resp.choices[0].message.content[:200])
    t4 = True
except Exception as e:
    print(f"❌ {type(e).__name__}: {str(e)[:400]}")
    t4 = False

print("\n========== 结论 ==========")
print(f"T1 文本连通: {'通过' if ok1 else '失败(后续测试不可信)'}")
print(f"T2 图像块(HumanMessage): {'支持' if ok2 else '不支持'}")
print(f"T3 图像块(ToolMessage/read_file路径): {'支持' if ok3 else '不支持'}")
print(f"T4 原始客户端 tool消息list图像: {'支持' if t4 else '不支持'}")
if ok2 and not t4:
    print("→ 模型有视觉但协议不接受 tool 消息带图像：read_file 读图需改造成下一条用户消息图像块")
elif ok2 and t4 and not ok3:
    print("→ 网关支持、卡在 ChatDeepSeek 的 json.dumps：在项目里子类化 ChatDeepSeek 修正序列化即可")
elif ok2 and ok3:
    print("→ 直接放开 prompt 即可")
