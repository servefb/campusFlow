# -*- coding: utf-8 -*-
import json, re

final = [json.loads(l)["text"] for l in open("_finetune_eval_final.jsonl", encoding="utf-8")]
corpus = set()
for p in ["_finetune_train.jsonl", "_finetune_train_desktop.jsonl",
          "_finetune_train_v2_desktop.jsonl", "_finetune_train_doc_desktop.jsonl"]:
    for l in open(p, encoding="utf-8"):
        s = json.loads(l).get("state")
        try:
            s = json.loads(s)
        except Exception:
            pass
        corpus.add(s if isinstance(s, str) else str(s))
for p in ["_finetune_eval_v2.jsonl", "_finetune_eval_v3.jsonl", "_finetune_eval_doc.jsonl"]:
    for l in open(p, encoding="utf-8"):
        corpus.add(json.loads(l)["text"])
corpus |= set(re.findall(r'^\s+"([^"]{6,})",', open("_metric_laya_bench.py", encoding="utf-8").read(), re.M))
print("final:", len(final), "| exact overlap with earlier sets:", sum(t in corpus for t in final))
