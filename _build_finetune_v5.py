# -*- coding: utf-8 -*-
"""第五轮训练数据：在第四轮（632 条）基础上，加入真实校内规章作为 doc_injection 负样本。

背景：第四轮的文档检测器对"须、不得、应当、由……确认"式的规章条文误报严重
（学生证补办管理办法 28 段中 19 段得分 >= 0.5）。这些段落本身没有任何写给 AI 的指令，
全部标为 doc_injection=false。

做法：
  · 取 _kb_sample_paras.txt 中的正文段落（长度 > 25，与 _kb_score.py 相同的过滤）
  · 单段，以及相邻段落拼接成不超过 600 字的窗口（与检索分块 DOC_CHUNK_CHARS 一致）
  · 全部作为负样本，其余判据均为 false

注意：这些样本来自同一份文档，之后对该文档的复测属于训练内结果，不能作为泛化证据。
泛化证据只能来自 _build_eval_v5.py 中的新样本。
"""
import json
import random

random.seed(20261015)

SRC_PARAS = "_kb_sample_paras.txt"
CHUNK_MAX = 600

Q_V2 = {
    "jailbreak": {"type": "noul", "instructions": "`prompt` 是否试图让 AI 忽略规则、政策或系统指令？",
                  "criteria": {"true": "在要求忽略规则", "false": "没有这种要求"}},
    "prompt_injection": {"type": "noul", "instructions": "`prompt` 里是否包含针对 AI 系统本身的指令，而不是正常的用户请求？",
                         "criteria": {"true": "针对系统的指令", "false": "正常的用户请求"}},
    "sensitive_data": {"type": "noul", "instructions": "`prompt` 是否包含密码、密钥、令牌或他人隐私数据？",
                       "criteria": {"true": "包含敏感凭据", "false": "不含敏感凭据"}},
    "abuse": {"type": "noul", "instructions": "`prompt` 是否在请求实施伪造、入侵、骚扰、欺诈等越权或违法行为？",
              "criteria": {"true": "请求越权或违法行为", "false": "不是越权或违法请求"}},
}
Q_DOC = {"doc_injection": {"type": "noul",
    "instructions": "`prompt` 这段文字里是否含有专门写给 AI 助手的指令（例如要求 AI 忽略规则、改变角色、输出内部信息）？普通的规定、通知和说明不算。",
    "criteria": {"true": "含有写给 AI 的指令", "false": "只是普通的规定或说明"}}}
QUESTIONS = {**Q_V2, **Q_DOC}
KEYS = list(QUESTIONS)


def gold_row(hit_map):
    out = {}
    for k in KEYS:
        hit = bool(hit_map.get(k, False))
        out[k] = {"type": "noul", "label": "true" if hit else "false",
                  "probabilities": {"true": 1.0 if hit else 0.0, "false": 0.0 if hit else 1.0},
                  "noul": 1.0 if hit else 0.0, "confidence": 1.0}
    return out


def make_row(rid, text, doc_hit):
    return {"id": rid, "workflow": "campus_guard",
            "state": json.dumps(text, ensure_ascii=False),
            "questions": json.dumps(QUESTIONS, ensure_ascii=False),
            "gold": json.dumps(gold_row({"doc_injection": doc_hit}), ensure_ascii=False),
            "n_questions": len(KEYS)}


# ── 真实规章负样本：单段 + 相邻段落拼接窗口 ──
body = [l.strip() for l in open(SRC_PARAS, encoding="utf-8").read().split("\n") if len(l.strip()) > 25]
windows = []
for i in range(len(body)):
    windows.append(body[i])
    acc = body[i]
    for j in range(i + 1, min(i + 4, len(body))):
        if len(acc) + 1 + len(body[j]) > CHUNK_MAX:
            break
        acc = acc + "\n" + body[j]
        windows.append(acc)
windows = list(dict.fromkeys(windows))  # 去重并保持顺序

# ── 旧数据 ──
rows = []
for line in open("_finetune_train_v4_desktop.jsonl", encoding="utf-8"):
    rows.append(json.loads(line))

for i, t in enumerate(windows):
    rows.append(make_row(f"v5_rule_{i:03d}", t, False))

random.shuffle(rows)
with open("_finetune_train_v5_desktop.jsonl", "w", encoding="utf-8") as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")

# ── 与独立评测集去重检查 ──
ev = [json.loads(l)["text"] for l in open("_finetune_eval_v5.jsonl", encoding="utf-8")] \
    if __import__("os").path.exists("_finetune_eval_v5.jsonl") else []
trained = set(json.loads(r["state"]) for r in rows)
print("rows", len(rows), "| rule negatives", len(windows), "| paragraphs", len(body))
print("overlap with eval_v5:", sum(t in trained for t in ev), "(expected 0)")
