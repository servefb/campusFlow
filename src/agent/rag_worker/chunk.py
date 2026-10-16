import os
import re
import logging
from langchain_core.documents import Document
from langchain_text_splitters import (
    RecursiveCharacterTextSplitter,
    MarkdownHeaderTextSplitter,
)

logger = logging.getLogger(__name__)

# ---------- 配置（修复：getenv 返回 str，必须转 int） ----------
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "512"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "64"))

# ---------- token 计算（懒加载，避免启动就依赖 tiktoken） ----------
_encoder = None

def _get_encoder():
    global _encoder
    if _encoder is None:
        import tiktoken
        _encoder = tiktoken.get_encoding("cl100k_base")
    return _encoder


def _count_tokens(text: str) -> int:
    try:
        return len(_get_encoder().encode(text))
    except Exception:
        # 兜底：粗略按字符数估算，中文约 1 字 1 token
        return len(text)


# ---------- 章节号提取 ----------
CHAPTER_RE = re.compile(r"第([一二三四五六七八九十百零\d]+)章")
ARTICLE_RE = re.compile(r"第([一二三四五六七八九十百零\d]+)条")
CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
          "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def _cn_to_int(s: str):
    if s.isdigit():
        return int(s)
    if s in CN_NUM:
        return CN_NUM[s]
    if "十" in s:
        parts = s.split("十")
        tens = CN_NUM.get(parts[0], 1) if parts[0] else 1
        ones = CN_NUM.get(parts[1], 0) if len(parts) > 1 and parts[1] else 0
        return tens * 10 + ones
    return None


def _extract_chapter_article(text: str):
    ch = CHAPTER_RE.search(text)
    ar = ARTICLE_RE.search(text)
    return (
        _cn_to_int(ch.group(1)) if ch else None,
        _cn_to_int(ar.group(1)) if ar else None,
    )


class _ChapterCounter:
    """兜底章号分配器（文档级，按 chunk 顺序发号）。

    背景：chapter_no / article_no 原本只从正文的「第X章 / 第X条」提取，
    而通知 / 手册 / 制度类文档根本没有这种结构 —— 入库后
    knowledge_sections 这两列整片 NULL，管理员在库里看到的就是一片空。

    适配规则：**抽不到「第X条」的块，按章处理** —— 按文档顺序依次补一个
    章号。分块严格按文档顺序产出，顺序编号即可，不需要理解文档结构。

    计数器同时记录已出现过的显式章号并取 max：混排文档（真有「第X章」的
    段落后面跟着普通段落）里，兜底章号从显式章号往后排，不会撞号。
    """

    def __init__(self):
        self._max = 0
        self.assigned = 0  # 实际发了多少个兜底章号（日志 / 自测用）

    def observe(self, chapter_no):
        if chapter_no is not None and chapter_no > self._max:
            self._max = chapter_no

    def next_chapter(self) -> int:
        self._max += 1
        self.assigned += 1
        return self._max


# ---------- 通用读文本 ----------
def _read_text(path):
    for enc in ("utf-8", "gbk", "latin-1"):
        try:
            with open(path, "r", encoding=enc) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    raise ValueError(f"无法识别编码: {path}")


# ---------- 加载器：都返回 List[Document] ----------
def _load_txt(path, file_name):
    text = _read_text(path)
    return [Document(page_content=text, metadata={"source": file_name})]


def _load_pdf(path, file_name):
    from pypdf import PdfReader
    reader = PdfReader(path)
    docs = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if text.strip():
            docs.append(Document(
                page_content=text,
                metadata={"source": file_name, "page": i + 1},
            ))
    return docs


def _load_docx(path, file_name):
    from docx import Document as DocxDocument
    doc = DocxDocument(path)
    docs = []

    for i, para in enumerate(doc.paragraphs):
        if para.text.strip():
            # 用样式名判断是否标题，作为 heading 元数据
            style = (para.style.name or "").lower() if para.style else ""
            meta = {"source": file_name, "paragraph": i}
            if "heading" in style or "标题" in style:
                meta["heading"] = para.text.strip()
            docs.append(Document(page_content=para.text, metadata=meta))

    for t, table in enumerate(doc.tables):
        rows = [" | ".join(c.text.strip() for c in row.cells)
                for row in table.rows]
        text = "\n".join(rows)
        if text.strip():
            docs.append(Document(
                page_content=text,
                metadata={"source": file_name, "table": t},
            ))
    return docs


def _load_markdown(path, file_name):
    # 保留原始 Markdown 文本，让 MarkdownHeaderTextSplitter 能识别 #
    text = _read_text(path)
    return [Document(page_content=text, metadata={"source": file_name})]


def _load_excel(path, file_name):
    from openpyxl import load_workbook
    wb = load_workbook(path, data_only=True)
    docs = []
    for name in wb.sheetnames:
        lines = [f"# Sheet: {name}"]
        for row in wb[name].iter_rows(values_only=True):
            cells = [str(c) if c is not None else "" for c in row]
            if any(cells):
                lines.append(" | ".join(cells))
        text = "\n".join(lines)
        if text.strip():
            docs.append(Document(
                page_content=text,
                metadata={"source": file_name, "sheet": name},
            ))
    return docs


_LOADERS = {
    ".txt": _load_txt, ".log": _load_txt,
    ".md": _load_markdown, ".markdown": _load_markdown,
    ".pdf": _load_pdf,
    ".docx": _load_docx,
    ".xlsx": _load_excel, ".xls": _load_excel,
}


def load_document(path: str, file_name: str):
    """返回 List[Document]。"""
    ext = os.path.splitext(file_name)[1].lower()
    loader = _LOADERS.get(ext)
    if not loader:
        raise ValueError(f"不支持的文件类型: {ext}")
    return loader(path, file_name)


# ---------- 分块器 ----------
def _chunk_recursive(docs):
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", "。", "！", "？", ". ", "! ", "? ", " ", ""],
    )
    return splitter.split_documents(docs)


def _chunk_markdown(docs):
    md_splitter = MarkdownHeaderTextSplitter(
        headers_to_split_on=[("#", "h1"), ("##", "h2"), ("###", "h3")]
    )
    sub = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )
    results = []
    for d in docs:
        md_chunks = md_splitter.split_text(d.page_content)
        for mc in md_chunks:
            merged = {**d.metadata, **mc.metadata}
            # 用 h1/h2/h3 拼出 heading
            heading_parts = [str(merged.get(k)) for k in ("h1", "h2", "h3")
                             if merged.get(k)]
            if heading_parts:
                merged["heading"] = " > ".join(heading_parts)
            for s in sub.split_text(mc.page_content):
                results.append(Document(page_content=s, metadata=merged))
    return results


# ---------- 分块后加工：补 knowledge_sections 需要的字段 ----------
def _enrich_chunk(chunk: Document, index: int, total: int,
                  counter: _ChapterCounter):
    """给每个 chunk 的 metadata 补上 chapter_no / article_no /
    section_label / token_count / chunkIndex / chunkTotal。

    chapter_no / article_no 取值优先级：
      1. 正文里的「第X章 / 第X条」（法规类文档，原行为）；
      2. 都抽不到时（article_no 为空）把该块当作一章，按文档顺序补章号，
         保证 knowledge_sections.chapter_no 不会整列 NULL。
    """
    text = chunk.page_content
    meta = chunk.metadata

    chapter_no, article_no = _extract_chapter_article(text)
    counter.observe(chapter_no)
    if chapter_no is None and article_no is None:
        # 「第X章」「第X条」都抽不到 → 该块没有条款结构，按章兜底编号
        chapter_no = counter.next_chapter()

    label_parts = []
    if chapter_no:
        label_parts.append(f"第{chapter_no}章")
    if article_no:
        label_parts.append(f"第{article_no}条")

    meta["chapter_no"] = chapter_no
    meta["article_no"] = article_no
    meta["section_label"] = "".join(label_parts) if label_parts else None
    meta["token_count"] = _count_tokens(text)
    meta["chunkIndex"] = index
    meta["chunkTotal"] = total
    # heading 兜底：如果加载器没给，用 section_label
    if not meta.get("heading") and meta["section_label"]:
        meta["heading"] = meta["section_label"]

    return chunk


def parse_and_chunk(file_path: str, file_name: str):
    """
    统一入口：解析 + 分块。
    返回 List[Document]，metadata 含：
      source, page/paragraph/sheet/table,
      heading, chapter_no, article_no, section_label,
      token_count, chunkIndex, chunkTotal
    """
    ext = os.path.splitext(file_name)[1].lower()
    docs = load_document(file_path, file_name)
    if not docs:
        logger.warning(f"文件内容为空: {file_name}")
        return []

    if ext in (".md", ".markdown"):
        chunks = _chunk_markdown(docs)
    else:
        chunks = _chunk_recursive(docs)

    chunks = [c for c in chunks if c.page_content.strip()]
    total = len(chunks)
    counter = _ChapterCounter()
    chunks = [_enrich_chunk(c, i, total, counter) for i, c in enumerate(chunks)]
    if counter.assigned:
        logger.info(
            f"{file_name} 有 {counter.assigned}/{total} 个分块无「第X章/第X条」结构，"
            f"已按文档顺序补章号"
        )

    logger.info(f"{file_name} 分块完成，共 {total} 块")
    return chunks