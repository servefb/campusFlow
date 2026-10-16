"""chunk.py 章节编号离线自测（不连 DB / 不发请求 / 不依赖外部服务）。

背景：knowledge_sections.chapter_no / article_no 原本只认正文里的
「第X章 / 第X条」，通知 / 手册类文档抽不到，入库后两列整片 NULL。
本次适配：抽不到「第X条」的块按章处理，按文档顺序补章号。

运行：.venv/Scripts/python.exe _chunk_section_selftest.py
（任何断言失败抛 AssertionError；在仓库根目录跑，保证 src 包可导入）
"""

import os
import sys
import tempfile

from langchain_core.documents import Document

from src.agent.rag_worker.chunk import (
    _ChapterCounter,
    _cn_to_int,
    _enrich_chunk,
    _extract_chapter_article,
    parse_and_chunk,
)

PASS = 0


def ok(name: str, cond: bool, detail: str = ""):
    global PASS
    assert cond, f"[FAIL] {name} {detail}"
    PASS += 1
    print(f"  ok  {name}")


def make(texts):
    return [Document(page_content=t, metadata={"source": "t.txt"}) for t in texts]


def enrich_all(texts):
    """按文档顺序跑一遍 _enrich_chunk，返回 (chapter_no 列表, article_no 列表)。"""
    counter = _ChapterCounter()
    chunks = [_enrich_chunk(c, i, len(texts), counter)
              for i, c in enumerate(make(texts))]
    return ([c.metadata["chapter_no"] for c in chunks],
            [c.metadata["article_no"] for c in chunks],
            [c.metadata["section_label"] for c in chunks])


# ---------- _cn_to_int ----------
print("== _cn_to_int ==")
ok("一→1", _cn_to_int("一") == 1)
ok("十二→12", _cn_to_int("十二") == 12)
ok("二十→20", _cn_to_int("二十") == 20)
ok("十→10", _cn_to_int("十") == 10)
ok("数字串→int", _cn_to_int("3") == 3)
ok("百不支持→None", _cn_to_int("百") is None)

# ---------- _extract_chapter_article ----------
print("== _extract_chapter_article ==")
ok("只有章", _extract_chapter_article("第一章 总则") == (1, None))
ok("只有条", _extract_chapter_article("第一条 为了规范宿舍管理") == (None, 1))
ok("章条都有", _extract_chapter_article("第二章 第三条 内容") == (2, 3))
ok("都没有", _extract_chapter_article("关于做好期末考试工作的通知") == (None, None))
ok("第十二条", _extract_chapter_article("第十二条 附则") == (None, 12))

# ---------- 兜底编号：普通文档（用户报的场景） ----------
print("== 兜底编号 ==")
chs, arts, labels = enrich_all(["第一段普通内容。", "第二段普通内容。",
                                "第三段普通内容。", "第四段普通内容。"])
ok("普通文档 chapter_no 顺序编号", chs == [1, 2, 3, 4], f"got {chs}")
ok("普通文档 article_no 仍为空", arts == [None] * 4, f"got {arts}")
ok("普通文档 section_label 第N章", labels == ["第1章", "第2章", "第3章", "第4章"],
   f"got {labels}")

# ---------- 兜底编号：混排文档不撞号 ----------
chs, arts, _ = enrich_all(["第一章 总则", "总则之后的普通段一", "普通段二"])
ok("显式章优先", chs[0] == 1)
ok("兜底章号排在显式章之后", chs == [1, 2, 3], f"got {chs}")

chs, arts, _ = enrich_all(["普通段一", "普通段二", "第五章 附则", "普通段三"])
ok("显式章保持原值", chs[2] == 5)
ok("兜底章号跟在 max 显式章后", chs == [1, 2, 5, 6], f"got {chs}")

# ---------- 法规类文档：原行为不变 ----------
chs, arts, labels = enrich_all([
    "第一章 总则", "第一条 为了规范管理，制定本办法。",
    "第二条 本办法适用于全校。", "第二章 分则", "第三条 学生应当遵守。",
])
ok("法规文档章号保持显式值", [c for c in chs if c is not None] == [1, 2],
   f"got {chs}")
ok("法规文档条号保持显式值", [a for a in arts if a is not None] == [1, 2, 3],
   f"got {arts}")
ok("只有条的块不补章号", chs[1] is None and chs[2] is None, f"got {chs}")

# ---------- 端到端：parse_and_chunk（txt 普通文档） ----------
print("== parse_and_chunk 端到端 ==")
with tempfile.TemporaryDirectory() as td:
    path = os.path.join(td, "notice.txt")
    body = "\n\n".join(
        f"第{i}段：关于期末寒假安排的通知正文，包含考试时间、成绩评定、假期安全"
        f"等事项的详细说明，每位同学都应认真阅读并遵守相关规定。"
        for i in range(1, 13)
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)

    chunks = parse_and_chunk(path, "notice.txt")
    ok("txt 分出多块", len(chunks) >= 2, f"got {len(chunks)}")
    chs = [c.metadata["chapter_no"] for c in chunks]
    arts = [c.metadata["article_no"] for c in chunks]
    ok("txt 普通文档 chapter_no 全非空且顺序编号",
       chs == list(range(1, len(chunks) + 1)), f"got {chs}")
    ok("txt 普通文档 article_no 全空", arts == [None] * len(chunks))
    ok("chunkIndex/chunkTotal 完整",
       [c.metadata["chunkIndex"] for c in chunks] == list(range(len(chunks)))
       and all(c.metadata["chunkTotal"] == len(chunks) for c in chunks))

# ---------- 端到端：parse_and_chunk（法规风格 txt） ----------
with tempfile.TemporaryDirectory() as td:
    path = os.path.join(td, "rule.txt")
    # 每条正文都加长，保证能真正分出多个 chunk（短文本会并成一块，
    # 一块里只取第一个章号/条号，那是分块粒度问题，不是编号问题）
    filler = "学生应当遵守学校各项规章制度，服从管理人员安排，共同维护良好秩序。"
    parts = ["第一章 总则"]
    for i in range(1, 7):
        parts.append(f"第{'一二三四五六'[i - 1]}条 本办法第{i}条的正文内容。"
                     f"{filler * 6}")
    parts.append("第二章 分则")
    for i in range(7, 10):
        parts.append(f"第{'七八九'[i - 7]}条 分则第{i}条的正文内容。{filler * 6}")
    body = "\n\n".join(parts)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)

    chunks = parse_and_chunk(path, "rule.txt")
    ok("法规文档分出多块", len(chunks) >= 2, f"got {len(chunks)}")
    got = [(c.metadata["chapter_no"], c.metadata["article_no"]) for c in chunks]
    ok("法规文档保留显式章号", any(c == 1 for c, _ in got), f"got {got}")
    arts = sorted(a for _, a in got if a is not None)
    ok("法规文档保留显式条号", 1 in arts and arts == sorted(set(arts)),
       f"got {arts}")
    ok("法规文档条号不越界", all(1 <= a <= 9 for a in arts), f"got {arts}")

print(f"\n全部通过（{PASS} 项断言）")
