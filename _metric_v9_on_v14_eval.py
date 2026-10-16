# -*- coding: utf-8 -*-
"""v9 护栏模型 × v14 留出测试集评测。

用法：
    python _metric_v9_on_v14_eval.py [模型目录] [阈值] [评测集文件] [模型标签]

不传模型目录时，自动在 unsloth studio outputs 里按**修改时间**取最新的
campusflow 系训练产出（multilingual__project-campusflow-*，覆盖 guard-v9 与
input-v3 等新项目；旧版本一律不看，用户明确要求）。
"""
import glob
import json
import os
import sys
import time

OUTPUTS_GLOB = os.path.expanduser("~/.unsloth/studio/outputs/multilingual__project-campusflow-*")
LABELS = None  # 运行时从首行 gold 的键推导：护栏 6 判据 / 文档 1 判据通用


def pick_latest_model_dir():
    cands = [d for d in glob.glob(OUTPUTS_GLOB) if os.path.isfile(os.path.join(d, "model.safetensors"))]
    if not cands:
        raise SystemExit(f"未找到 v9 训练产出：{OUTPUTS_GLOB}")
    cands.sort(key=lambda d: os.path.getmtime(d))
    latest = cands[-1]
    print(f"[model] 候选 {len(cands)} 个，取最新：{latest} (mtime={time.strftime('%H:%M:%S', time.localtime(os.path.getmtime(latest)))})")
    for d in cands[:-1]:
        print(f"[model] 忽略较旧：{d}")
    return latest


def main():
    model_dir = sys.argv[1] if len(sys.argv) > 1 else pick_latest_model_dir()
    threshold = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5
    eval_file = sys.argv[3] if len(sys.argv) > 3 else "_finetune_eval_v14.jsonl"
    model_tag = sys.argv[4] if len(sys.argv) > 4 else "v9"
    eval_tag = os.path.splitext(os.path.basename(eval_file))[0].replace("_finetune_eval_", "")
    out_file = f"_metric_{model_tag}_on_{eval_tag}.json"

    rows = [json.loads(l) for l in open(eval_file, encoding="utf-8") if l.strip()]
    print(f"[data] {eval_file}: {len(rows)} rows, threshold={threshold}")
    global LABELS
    LABELS = list(json.loads(rows[0]["gold"]))
    print(f"[data] labels: {LABELS}")

    from laya import Agent
    t0 = time.time()
    agent = Agent(model_dir)
    print(f"[load] Agent ready in {time.time()-t0:.1f}s")

    stats = {l: {"tp": 0, "fp": 0, "fn": 0, "tn": 0, "scores_pos": [], "scores_neg": []} for l in LABELS}
    per_row, errors = [], []
    t0 = time.time()
    for i, r in enumerate(rows):
        state = json.loads(r["state"])
        questions = json.loads(r["questions"])
        gold = json.loads(r["gold"])
        try:
            res = agent.system_one({"prompt": state}, questions)
            probs = {k: float(v["noul"]) for k, v in res["answers"].items()}
        except Exception as e:
            errors.append({"id": r["id"], "error": repr(e)})
            continue
        rec = {"id": r["id"], "probs": probs, "gold": {l: gold[l]["label"] for l in LABELS},
               "text": state}
        for l in LABELS:
            p = probs.get(l)
            y = gold[l]["label"] == "true"
            hit = p is not None and p >= threshold
            if y and hit:
                stats[l]["tp"] += 1
            elif y and not hit:
                stats[l]["fn"] += 1
            elif not y and hit:
                stats[l]["fp"] += 1
            else:
                stats[l]["tn"] += 1
            if p is not None:
                (stats[l]["scores_pos" if y else "scores_neg"]).append(round(p, 4))
        per_row.append(rec)
        if (i + 1) % 20 == 0:
            print(f"[run] {i+1}/{len(rows)} elapsed={time.time()-t0:.0f}s")

    def prf(s):
        p = s["tp"] / (s["tp"] + s["fp"]) if s["tp"] + s["fp"] else 0.0
        r = s["tp"] / (s["tp"] + s["fn"]) if s["tp"] + s["fn"] else 0.0
        f = 2 * p * r / (p + r) if p + r else 0.0
        fk = s["fp"] / (s["fp"] + s["tn"]) if s["fp"] + s["tn"] else 0.0
        return p, r, f, fk

    print("\n===== 分维度指标 (threshold=%.2f) =====" % threshold)
    print(f"{'dimension':18s} {'TP':>4s} {'FP':>4s} {'FN':>4s} {'TN':>4s} {'precision':>9s} {'recall':>7s} {'F1':>6s} {'误拦率':>7s}")
    per_dim = {}
    for l in LABELS:
        s = stats[l]
        p, r, f, fk = prf(s)
        per_dim[l] = {"tp": s["tp"], "fp": s["fp"], "fn": s["fn"], "tn": s["tn"],
                      "precision": round(p, 4), "recall": round(r, 4), "f1": round(f, 4),
                      "false_kill_rate": round(fk, 4),
                      "score_max_neg": max(s["scores_neg"]) if s["scores_neg"] else None,
                      "score_min_pos": min(s["scores_pos"]) if s["scores_pos"] else None,
                      "score_median_pos": (sorted(s["scores_pos"])[len(s["scores_pos"]) // 2]) if s["scores_pos"] else None}
        print(f"{l:18s} {s['tp']:4d} {s['fp']:4d} {s['fn']:4d} {s['tn']:4d} {p:9.3f} {r:7.3f} {f:6.3f} {fk:7.1%}")

    total_tp = sum(stats[l]["tp"] for l in LABELS)
    total_fp = sum(stats[l]["fp"] for l in LABELS)
    total_fn = sum(stats[l]["fn"] for l in LABELS)
    total_tn = sum(stats[l]["tn"] for l in LABELS)
    print(f"\n[overall] micro-acc = {(total_tp+total_tn)/max(1,total_tp+total_fp+total_fn+total_tn):.4f} "
          f"TP={total_tp} FP={total_fp} FN={total_fn} TN={total_tn} errors={len(errors)}")

    # 典型误拦 / 漏报明细
    worst_fp, worst_fn = [], []
    for rec in per_row:
        for l in LABELS:
            p = rec["probs"].get(l)
            if p is None:
                continue
            if rec["gold"][l] == "false" and p >= threshold:
                worst_fp.append({"id": rec["id"], "dim": l, "score": p, "text": rec["text"][:60]})
            if rec["gold"][l] == "true" and p < threshold:
                worst_fn.append({"id": rec["id"], "dim": l, "score": p, "text": rec["text"][:60]})
    worst_fp.sort(key=lambda x: -x["score"])
    worst_fn.sort(key=lambda x: x["score"])

    result = {"model_dir": model_dir, "eval_file": eval_file, "threshold": threshold,
              "n_rows": len(rows), "per_dimension": per_dim,
              "overall": {"tp": total_tp, "fp": total_fp, "fn": total_fn, "tn": total_tn,
                          "micro_accuracy": round((total_tp + total_tn) / max(1, total_tp + total_fp + total_fn + total_tn), 4)},
              "worst_false_positives": worst_fp[:20], "worst_false_negatives": worst_fn[:20],
              "errors": errors,
              "per_row": per_row}
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print(f"\n[done] 结果写入 {out_file}（耗时 {time.time()-t0:.0f}s）")
    if worst_fp:
        print("\n--- 误拦 TOP5 ---")
        for x in worst_fp[:5]:
            print(f"  {x['dim']:16s} {x['score']:.3f} {x['id']} | {x['text']}")
    if worst_fn:
        print("\n--- 漏报 TOP5 ---")
        for x in worst_fn[:5]:
            print(f"  {x['dim']:16s} {x['score']:.3f} {x['id']} | {x['text']}")


if __name__ == "__main__":
    main()
