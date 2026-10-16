# -*- coding: utf-8 -*-
"""知识库样例 Word 文档的共用构件。

两个要点：
1. run.font.name 只管西文，中文必须补 w:eastAsia，否则 Word 里会退回默认字体。
2. 章 / 条 编号与 Heading 样式是入库链路（src/agent/rag_worker/chunk.py）认字段的唯一入口，
   正文排版再漂亮，编号写法不对也抽不到 chapter_no / article_no。
"""
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt

BODY_FONT = "宋体"
HEAD_FONT = "微软雅黑"


def set_style_font(style, name, size, bold=False):
    style.font.name = name
    style.font.size = Pt(size)
    style.font.bold = bold
    style.element.rPr.rFonts.set(qn("w:eastAsia"), name)


def new_document(body_size=11.0):
    """带中文正文/标题字体的空文档。"""
    doc = Document()

    normal = doc.styles["Normal"]
    set_style_font(normal, BODY_FONT, body_size)
    normal.paragraph_format.space_after = Pt(4)
    normal.paragraph_format.line_spacing = 1.4

    for lvl, size in ((1, 15), (2, 13)):
        set_style_font(doc.styles[f"Heading {lvl}"], HEAD_FONT, size, bold=True)
    return doc


def add_cover_info(doc, lines):
    """封面信息块：文号 / 发布单位 / 日期都在这里，要落在正文前 1500 字内。"""
    for line in lines:
        doc.add_paragraph(line)


def add_table(doc, rows, widths_cm, font_size=10.0):
    """rows[0] 为表头。widths_cm 给每列宽度（cm）。"""
    table = doc.add_table(rows=0, cols=len(widths_cm))
    table.style = "Table Grid"
    for i, row in enumerate(rows):
        cells = table.add_row().cells
        for cell, text in zip(cells, row):
            cell.text = ""
            run = cell.paragraphs[0].add_run(text)
            run.font.size = Pt(font_size)
            run.bold = i == 0
            run.font.name = BODY_FONT
            run._element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)
    for row in table.rows:
        for cell, w in zip(row.cells, widths_cm):
            cell.width = w
    return table


def add_articles(doc, articles):
    """[('第一条 【目的】', '正文…'), …] —— 条号加粗，正文接排。"""
    for head, body in articles:
        p = doc.add_paragraph()
        p.add_run(head).bold = True
        p.add_run(body)


def add_end_note(doc, text="（正文完）"):
    end = doc.add_paragraph(text)
    end.alignment = WD_ALIGN_PARAGRAPH.CENTER
    return end
