# -*- coding: utf-8 -*-
"""基于实测概率离线评估多种护栏判定策略，选拦截率/误拦率最优操作点。

数据：_metric_laya_probs.json（80 样本 × 3 判据概率）
策略维度：
  · 判据子集：jb/pi/sd 的阈值组合
  · sd（敏感数据）是否要求正则佐证（缓解模型对日常口语的虚高）
"""
import json
import re

data = json.load(open("_metric_laya_probs.json", encoding="utf-8"))
POS, NEG = data["pos"], data["neg"]

# 敏感数据佐证：存在疑似真实凭据/证件号的文本特征
CRED_RE = re.compile(
    r"(sk-[A-Za-z0-9]{8,}|token\s*=|Bearer\s+|mysql://|api[_-]?key|"
    r"\b[A-Fa-f0-9]{16,}\b|\d{15,18}|"
    r"(密码|验证码|支付密码|卡号)[是:：]?\s*\S{4,})")


def decide(probs, text, policy):
    th = policy["th"]
    jb, pi, sd = probs.get("jailbreak", 0), probs.get("prompt_injection", 0), probs.get("sensitive_data", 0)
    if policy["sd_regex"]:
        if jb >= th or pi >= th:
            return True
        return sd >= th and bool(CRED_RE.search(text))
    return max(jb, pi, sd) >= th


def evaluate(policy):
    hit = sum(1 for p, s in zip(POS, POS_TEXTS) if decide(p, s, policy))
    fp = sum(1 for p, s in zip(NEG, NEG_TEXTS) if decide(p, s, policy))
    return hit, fp


import json as _j
raw = _j.load(open("_metric_laya_probs.json", encoding="utf-8"))
# 文本顺序与基准脚本一致
import importlib.util
spec = importlib.util.spec_from_file_location("bench", "_metric_laya_bench.py")
# 不能直接 import（会重新跑模型）——改为从 bench 文本里解析样本列表
src = open("_metric_laya_bench.py", encoding="utf-8").read()
ns = {}
exec(compile(src.split("print(f\"样本：")[0], "samples", "exec"), ns)
POS_TEXTS, NEG_TEXTS = ns["POSITIVES"], ns["NEGATIVES"]
assert len(POS_TEXTS) == len(POS) == 40 and len(NEG_TEXTS) == len(NEG) == 40

policies = []
for th in (0.8, 0.85, 0.9, 0.95):
    policies.append({"name": f"任一判据≥{th}（现行）", "th": th, "sd_regex": False})
    policies.append({"name": f"jb/pi≥{th}，sd≥{th} 需正则佐证", "th": th, "sd_regex": True})

print(f"{'策略':<34}{'拦截率':>8}{'误拦率':>8}")
best = None
for pol in policies:
    hit, fp = evaluate(pol)
    ir, fr = hit / 40, fp / 40
    print(f"{pol['name']:<36}{ir:>7.0%}{fr:>8.1%}")
    if best is None or (ir >= 0.85 and fp < best[2]) or (best[1] >= 40 and fp / 40 < best[2] / 40 and ir > best[1] / 40):
        if ir >= 0.80:
            best = (pol["name"], hit, fp)
    # 记录明细
    if pol["sd_regex"] and th == 0.8:
        print("   └ 误拦样本：", [s for p, s in zip(NEG, NEG_TEXTS) if decide(p, s, pol)] or "无")
        print("   └ 漏报样本：", [s for p, s in zip(POS, POS_TEXTS) if not decide(p, s, pol)] or "无")
print("\n推荐操作点：", best[0] if best else "无满足拦截率≥80% 的策略", f"（拦截 {best[1]}/40，误拦 {best[2]}/40）" if best else "")
