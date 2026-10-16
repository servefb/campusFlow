from langchain_tavily import TavilySearch
import dotenv

dotenv.load_dotenv()
from langchain_core.tools import tool

from src.agent.tools.laya_guard import guard_retrieved


@tool
def search(query: str, topic: str, time_range: str, search_depth: str, purpose: str) -> str:
    """
   使用 Tavily 搜索互联网，返回与查询相关的答案、搜索结果和网页全文。

   何时使用：
   - 需要查找最新信息、新闻、财经资讯或通用网页资料时。
   - 需要 Tavily 直接生成较详细的答案，并附带来源链接和 Markdown 全文时。

   参数：
   - query: 搜索关键词或自然语言问题。
   - topic: 搜索类别，可选 general（通用）、news（新闻）、finance（财经）。
   - time_range: 时间范围，可选 day（一天内）、week（一周内）、month（一月内）、year（一年内）。
   - search_depth: 搜索深度，可选 basic（快速）或 advanced（更深入、更慢但更全面）。
   - purpose: **为什么要做这次搜索**，一句话、面向用户。调用前会弹权限确认卡，
     这句话就是卡片上给用户看的说明（如「查询 LangChain 的最新版本与发布说明」）——
     写具体要查什么，别写「为了回答用户问题」这类空话。不参与检索。

   返回：
   - Tavily 搜索结果，通常包含 answer、results 列表，以及每条结果的 title、url、content、raw_content 等字段。
   """
    _search = TavilySearch(
        max_results=5,  # 返回结果数量（默认 5）
        topic=topic,  # 搜索类别：general / news / finance
        include_answer="advanced",  # 让 Tavily 直接生成详细答案
        search_depth=search_depth,  # 搜索深度：basic / advanced
        time_range=time_range,  # 时间范围：day / week / month / year
        include_raw_content="markdown",  # 同时返回清洗后的 Markdown 全文
    )
    return guard_retrieved("web:search", _search.invoke(query))


from langchain_tavily import TavilyExtract


@tool
def extract(urls: list, purpose: str) -> str:
    """
    从指定的一个或多个 URL 中提取网页正文内容。

    何时使用：
    - 已经有明确的 URL，需要抓取并清洗页面内容时。
    - 搜索得到链接后，需要进一步读取网页详情时。

    参数：
    - urls: 要提取内容的 URL 列表，例如 ["https://example.com/article"]。
    - purpose: **为什么要抓这些页面**，一句话、面向用户（会显示在权限确认卡片上）。不参与抓取。

    返回：
    - 每个 URL 的提取结果，通常包含 url、title、raw_content 等；失败时可能包含错误信息。
    """
    _extract = TavilyExtract()
    return guard_retrieved("web:extract", _extract.invoke(urls))


from langchain_tavily import TavilyCrawl


@tool
def crawl(url: str, purpose: str) -> str:
    """
   从起始 URL 爬取网站，并按深度和广度收集多个页面内容。

   何时使用：
   - 需要遍历站点内多个页面，而不是只读取单个 URL 时。
   - 需要批量收集某网站内的文章、文档或页面内容时。

   参数：
   - url: 爬取起始网址。
   - purpose: **为什么要爬这个站点**，一句话、面向用户（会显示在权限确认卡片上）。不参与抓取。
   - 当前配置：max_depth=2，max_breadth=10，即最多向下 2 层、每层最多 10 个链接。

   返回：
   - 爬取到的页面结果，通常包含 base_url、results 列表，每个页面包含 url、raw_content 等。
   """
    _crawl = TavilyCrawl(max_depth=2, max_breadth=10)
    return guard_retrieved("web:crawl", _crawl.invoke({"url": url}))


from langchain_tavily import TavilyMap


@tool
def map_site(url: str, purpose: str) -> str:
    """
   映射指定站点的 URL 结构，发现站点内可访问的链接列表。

   何时使用：
   - 需要先了解网站有哪些页面、文档或栏目时。
   - 在 crawl 或 extract 之前，先获取站点 URL 地图时。

   参数：
   - url: 站点起始 URL。
   - purpose: **为什么要扫描这个站点**，一句话、面向用户（会显示在权限确认卡片上）。不参与抓取。

   返回：
   - 站点地图信息，通常包含 base_url 和 results，results 为发现的 URL 列表。
   """
    _map = TavilyMap()
    return _map.invoke({"url": url})
