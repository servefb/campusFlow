# -*- coding: utf-8 -*-
import httpx

def _n(*a, **k):
    raise RuntimeError("no network")
httpx.Client.send = _n; httpx.Client.request = _n; httpx.get = _n; httpx.post = _n

from laya import Agent
from src.agent.tools.laya_guard import DOC_QUESTION

import sys
ag = Agent(sys.argv[1])
paras = [l for l in open("_kb_sample_paras.txt", encoding="utf-8").read().split("\n") if len(l) > 25]
res = []
for p in paras:
    r = ag.system_one({"prompt": p}, DOC_QUESTION)
    res.append((float(r["answers"]["doc_injection"]["noul"]), p))
res.sort(reverse=True)
for s, p in res[:8]:
    print("%.3f | %s" % (s, p[:90]))
print("paragraphs >=0.5:", sum(s >= 0.5 for s, _ in res), "of", len(res))
