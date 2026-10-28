# -*- coding: utf-8 -*-
"""跨轮历史窗口的 token 节省实测（离线，无网络依赖）。

方法：构造 40 轮合成校园对话（问 ~40 字 / 答 ~180 字，贴近真实问答长度），
对比两种策略在**每一轮请求**实际要发给模型的历史字符量（≈ token 量的稳定代理）：
  · baseline：每轮全量重发历史（折叠机制上线前的行为）
  · window  ：本项目策略——近 12 轮原文 + 更早轮次折叠为滚动摘要
摘要长度按被折叠原文的 25% 估算（LLM 蒸馏通常压到 1~3 成，取保守中值）。
复用 src.agent.history_utils.plan_history_window 的真实切窗逻辑，不重造轮子。
"""
import statistics

from langchain_core.messages import HumanMessage, AIMessage

from src.agent.history_utils import plan_history_window, HISTORY_KEEP_ROUNDS

QUESTIONS = [
    "补办学生证需要多久？", "图书馆周日几点开门？", "二食堂周末营业到几点？",
    "选课系统什么时候开放退改选？", "四六级怎么报名？", "校园卡丢了怎么挂失？",
    "羽毛球场地怎么预约？", "奖学金评定标准是什么？", "宿舍热水器坏了找谁？",
    "期末考试安排什么时候出？", "转专业条件和流程？", "有哪些社团推荐？",
    "校车时刻表几点一趟？", "校医院周末能看病吗？", "助学贷款怎么办？",
    "勤工俭学岗位在哪找？", "考研自习室怎么申请？", "宿舍门禁几点？",
    "网球场晚上收费吗？", "普通话考试在哪报名？", "计算机二级有用吗？",
    "第二课堂学分不够怎么办？", "二手教材哪里买？", "心理中心怎么预约？",
    "毕业论文查重率要求？", "寒假留校怎么申请？", "校园网密码怎么改？",
    "三四节课几点下课？", "实习证明找谁盖章？", "哪个窗口麻辣香锅好吃？",
    "运动会怎么报名？", "附近有没有靠谱驾校？", "晚自习缺勤有影响吗？",
    "三方协议能毁约吗？", "元旦火车票什么时候开抢？", "夏天宿舍断电吗？",
    "取件码忘了怎么办？", "英语角每周几活动？", "发传单兼职多少钱一小时？",
    "毕业档案怎么迁回原籍？",
]
ANSWER_TAIL = ("流程如下：先在公众号预约，带好身份证和学生证到服务窗口办理，"
               "一般 3 个工作日内完成。如果遇到高峰期可能顺延，建议错开月底办理。"
               "另外注意材料不齐会被退回，最好提前打电话确认窗口营业时间。")

N_ROUNDS = len(QUESTIONS)
assert N_ROUNDS == 40


def build_round(i):
    q = QUESTIONS[i]
    # 答复长度在 120~220 字间波动，贴近真实
    a = q + "，" + ANSWER_TAIL[:140 + (i * 17) % 80]
    return [HumanMessage(content=q), AIMessage(content=a)]


def chars(msgs):
    return sum(len(getattr(m, "content", "") or "") for m in msgs)


SUMMARY_RATIO = 0.25  # 摘要长度 = 被折叠原文的 25%

# ── baseline：每轮全量重发 ──
baseline_round_inputs = []
all_msgs = []
for i in range(N_ROUNDS):
    all_msgs.extend(build_round(i))
    baseline_round_inputs.append(chars(all_msgs))  # 本轮请求要发的历史

# ── window：真实切窗逻辑 ──
window_round_inputs = []
sanitized, covered, summary_len = [], 0, 0
for i in range(N_ROUNDS):
    sanitized.extend(build_round(i))
    to_fold, kept = plan_history_window(sanitized, covered)
    if to_fold:
        # 折叠：covered 前移，摘要长度按 25% 累加
        covered += len(to_fold)
        summary_len += int(chars(to_fold) * SUMMARY_RATIO)
    window_round_inputs.append(summary_len + chars(kept))

# ── 汇总 ──
pairs = [(b, w) for b, w in zip(baseline_round_inputs, window_round_inputs)]
late = pairs[12:]  # 窗口生效后（第 13 轮起）
avg_b = statistics.mean(b for b, _ in late)
avg_w = statistics.mean(w for _, w in late)
red_late = 1 - avg_w / avg_b
red_40 = 1 - pairs[-1][1] / pairs[-1][0]

print(f"对话轮数：{N_ROUNDS}，保留窗口：近 {HISTORY_KEEP_ROUNDS} 轮，摘要压缩比：{SUMMARY_RATIO:.0%}")
print(f"{'轮次':>4} {'全量(字符)':>10} {'窗口(字符)':>10} {'节省':>7}")
for r in (13, 20, 30, 40):
    b, w = pairs[r - 1]
    print(f"{r:>4} {b:>10} {w:>10} {(1 - w / b):>6.0%}")
print(f"\n第 13 轮起平均单轮输入：全量 {avg_b:.0f} 字 vs 窗口 {avg_w:.0f} 字")
print(f"平均降低：{red_late:.0%}；第 40 轮单次请求降低：{red_40:.0%}")
print(f"（按 DeepSeek 中文约 0.6~0.7 token/字符折算，比例不变）")
