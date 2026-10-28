# -*- coding: utf-8 -*-
"""第六轮训练数据：在第五轮基础上，恢复用户输入侧的样本权重。

第五轮的问题：加入 106 条规章负样本后，用户输入侧的攻击捕获从 36/40 降到 29/40。
做法：
  · 第五轮的全部样本保留（文档侧负样本、攻击样本、旧用户样本）
  · 第四轮新增的用户侧样本（id 以 v4_ 开头，共 49 条）整体再加一份，这类样本从 49 条变为 98 条
  · 最后打乱顺序

注意：重复样本是同一句话的完整副本，不是新样本，所以这一步只是调整权重，不增加多样性。
"""
import json
import random

random.seed(20261016)

rows = [json.loads(l) for l in open("_finetune_train_v5_desktop.jsonl", encoding="utf-8")]
user_rows = [r for r in rows if r["id"].startswith("v4_")]
extra = [dict(r, id=r["id"] + "_dup") for r in user_rows]
rows = rows + extra

random.shuffle(rows)
with open("_finetune_train_v6_desktop.jsonl", "w", encoding="utf-8") as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")

# ── 检查：与所有评测集的精确重叠（应为 0，或只有第四轮已知的最终测试句）──
evals = {}
for p in ["_finetune_eval_v5.jsonl", "_finetune_eval_fresh.jsonl", "_finetune_eval_final.jsonl",
          "_finetune_eval_doc.jsonl", "_finetune_eval_v3.jsonl", "_finetune_eval_v2.jsonl"]:
    evals[p] = set(json.loads(l)["text"] for l in open(p, encoding="utf-8"))
trained = set(json.loads(r["state"]) for r in rows)
print("rows", len(rows), "| user-side rows (v4_*) total incl. dup:", len(user_rows) * 2,
      "| user-side original:", len(user_rows))
for p, s in evals.items():
    print("overlap with", p, ":", len(trained & s))
