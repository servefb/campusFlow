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
# 按条切分的分界点：行首（允许缩进）的「第X条」。用零宽前瞻切，切出来的
# 每一段都以「第X条」开头 —— 这是段落归属的唯一凭据，不能丢。
ARTICLE_SPLIT_RE = re.compile(r"(?m)(?=^[ \t\u3000]*第[一二三四五六七八九十百零\d]+条)")
# 短于这个字数的碎片并到下一段。按条切之后「第一章 总则」会自成一段（7 个字），
# 单独入库就是一个检索不出东西、还占 top-k 名额的碎块。
MIN_MERGE_CHARS = 80
# 按条切的块允许超出 CHUNK_SIZE 这么多才二次切。
# 为什么不是硬卡 512：合并短标题会把刚好 500 字的条款顶到 512 以上，
# 若立刻二次切，切点正好落在「标题」与「第一条」的接缝上 —— 又切出一个
# 6 个字的碎块。条款完整性优先，多几十个字不值得切开。
ARTICLE_SOFT_MAX = CHUNK_SIZE + MIN_MERGE_CHARS
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


def _has_article_structure(docs) -> bool:
    """值不值得按「第X条」预切。

    阈值 2：单处命中多半是正文里的引用（「依据《XX办法》第十二条」），
    照它切会把一句话劈成两半。锚在行首也是同一个考虑 —— 真条款从行首起。
    """
    return sum(len(ARTICLE_SPLIT_RE.findall(d.page_content)) for d in docs) >= 2


def _is_fragment(text: str) -> bool:
    """短且不是条款开头的，才算碎块。

    「第五条 本办法自发布之日起施行。」只有十几个字，但它是个**完整**的条，
    并进上一块就会把内容挂在第 N-1 条的 label 下 —— 标签错了比块小更糟。
    真正该并的是「第一章 总则」这种标题、以及二次切分留下的续块尾巴。
    """
    return (len(text) < MIN_MERGE_CHARS
            and not re.match(r"[ \t\u3000]*第[一二三四五六七八九十百零\d]+条", text))


def _merge_short_pieces(pieces):
    """把过短的碎片并到后面的段落上（顺序处理，不改动文字顺序）。

    攒够 MIN_MERGE_CHARS 才出块；攒不够并进下一段；末尾剩余若是碎块并进上一块
    （是完整条款就自己成块——否则最后一小条会被挂到前一条名下）。
    「第一章 总则」这种标题因此会挂到第一条前面，而不是单独成块。
    """
    merged, buf = [], ""
    for p in pieces:
        buf = f"{buf}\n{p}" if buf else p
        if len(buf) >= MIN_MERGE_CHARS:
            merged.append(buf)
            buf = ""
    if buf:
        if merged and _is_fragment(buf):
            merged[-1] = f"{merged[-1]}\n{buf}"
        else:
            merged.append(buf)
    return merged


def _merge_fragments(chunks):
    """把二次切分留下的微型碎块并回相邻块（优先并进前一块）。

    递归切分遇到「第一章 总则\\n第一条 …」这种接缝时，会先切出一个只有几个字的块。
    碎块检索不出东西、还占 top-k 名额，一律并回去；并完略超 CHUNK_SIZE 也无妨 ——
    条款完整性优先于卡死字数。
    """
    out = []
    for c in chunks:
        if out and _is_fragment(c.page_content):
            prev = out[-1]
            prev.page_content = f"{prev.page_content}\n{c.page_content}"
        else:
            out.append(c)
    if len(out) >= 2 and _is_fragment(out[0].page_content):
        out[1].page_content = f"{out[0].page_content}\n{out[1].page_content}"
        out.pop(0)
    return out


def _chunk_by_article(docs):
    """先按「第X条」预切，条内再递归切。

    制度/办法类文档的最小语义单元是"条"，不是 512 字符：按固定字符数硬切会把
    一条拦腰截断 —— 前半句「须提交下列材料：」留在上一块，清单落到下一块，
    而 section_label 还标着一条并不完整的条。先按条切、只对超长条款二次切，
    块边界就和条边界对齐了。

    二次切开的续块正文里没有「第X条」，靠 metadata 里留的 `_chapter_no` /
    `_article_no` 保住归属（`_enrich_chunk` 会读，读完就 pop 掉）。
    """
    sub = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", "。", "！", "？", ". ", "! ", "? ", " ", ""],
    )
    results = []
    for d in docs:
        pieces = [p.strip() for p in ARTICLE_SPLIT_RE.split(d.page_content) if p.strip()]
        doc_chunks = []
        for piece in _merge_short_pieces(pieces):
            chapter_no, article_no = _extract_chapter_article(piece)
            meta = dict(d.metadata)
            if chapter_no is not None:
                meta["_chapter_no"] = chapter_no
            if article_no is not None:
                meta["_article_no"] = article_no
            if len(piece) <= ARTICLE_SOFT_MAX:
                doc_chunks.append(Document(page_content=piece, metadata=meta))
            else:
                doc_chunks.extend(sub.create_documents([piece], metadatas=[meta]))
        results.extend(_merge_fragments(doc_chunks))
    return results


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
    # 超长条款被二次切开时，续块正文里已经没有「第X条」了。_chunk_by_article
    # 在 metadata 里留了父条款号，优先认它 —— 否则这些续块会被兜底逻辑当成
    # 新的一章挨个编号，管理端看到的章节号就全乱了。读完即 pop，不外泄。
    parent_chapter = meta.pop("_chapter_no", None)
    parent_article = meta.pop("_article_no", None)
    if chapter_no is None:
        chapter_no = parent_chapter
    if article_no is None:
        article_no = parent_article
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
    elif _has_article_structure(docs):
        chunks = _chunk_by_article(docs)
        logger.info(f"{file_name} 含条款结构，已按「第X条」预切")
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