# 知识库 RAG 测试数据

给 Campus Flow 知识库造的一套可上传语料，用来验证「上传 → 解析切片 → 检索 → 引用」整条链路。

不是 SQL 种子 —— 库里的 4 篇种子文档（`知识库文档` 表 id 29/30/31/32）只能证明页面不白屏，
证明不了**检索**是对的。这套数据是按检索用例反推着写的：每个分类、每种效力状态、
每种可见性都有对应文档，正文里埋了只在正文出现的特征词（`专业前10%`、`违章电器`、`五号公寓`、`6100119`、
`绿色通道`、`报到证`……），用来分辨「搜标题」和「搜正文」。

## 目录结构

```
知识库测试数据/
├── docs/                      16 篇 Markdown 原文（主稿，可读可改）
├── pdf/                       16 篇 A4 PDF（由 docs 生成，供只吃 PDF 的解析器）
│   └── _html/                 中间 HTML，改版式用，别上传
├── metadata.csv               每篇的元数据：文号、发布单位、分类、可见性、效力、施行日期
├── 检索验证用例.md             ground truth：查询 → 期望命中 → 判定口径
├── upload-knowledge-seed.mjs  批量上传脚本（调 /files/presign + /knowledge/admin/documents）
└── build-pdf.mjs              docs/*.md → pdf/*.pdf（本机 Chrome printToPDF）
```

## 语料覆盖

| 编号 | 文档 | 分类 | 效力 | 可见性 | 状态 | 这条数据负责测什么 |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | 国家奖学金评选实施细则 | 奖助学金 | current | student | ready | 与种子 29 同款，检索基准线 |
| 02 | 国家奖学金评选办法（2024版） | 奖助学金 | archive | student | archived | 同名旧版；与 01 构成冲突对 |
| 03 | 本科生学籍管理规定 | 教务 | current | campus | ready | 与种子 30 同款；含学生证补办 |
| 04 | 本科生学籍管理规定（2025修订稿） | 教务 | revised | campus | draft | 同名修订稿；与 03 构成冲突对 |
| 05 | 综合素质测评实施办法 | 校规 | current | student | ready | 与种子 31 同款；公示申诉条款与 09 重叠 |
| 06 | 本科生选课与退补选管理办法 | 教务 | current | campus | ready | 时间窗口类问答主依据 |
| 07 | 考试违纪认定与学业预警处理办法 | 教务 | current | **teacher** | ready | 学生身份不得命中 |
| 08 | 家庭经济困难学生认定办法 | 奖助学金 | current | student | ready | 等级划分 + 多层列表 |
| 09 | 奖学金评定公示与申诉办法 | 奖助学金 | current | campus | ready | 与 05 语义重叠，测引用择优 |
| 10 | 学生宿舍管理办法 | 园区生活 | current | campus | ready | 宿舍类主依据 |
| 11 | 学生宿舍用电与消防安全细则 | 园区生活 | current | **department** | ready | 部门可见；数字阈值 + 表格 |
| 12 | 校园卡使用与补办管理规定 | 园区生活 | current | public | ready | 公开可见；窗口类短文档 |
| 13 | 毕业生就业推荐表与三方协议办理指南 | 就业 | current | public | ready | 三步式办事流程 |
| 14 | 推免（保研）实施办法 | 升学 | current | student | ready | 多条件叠加问答 |
| 15 | 校园机动车停放管理办法（征求意见稿） | 校规 | current | campus | **draft** | 未发布不得进检索；治理页可见 |
| 16 | 2026级本科生入学须知 | 校规 | current | campus | ready | **无文号**；通知类分节结构 |

覆盖到的枚举：`validity` 4 种全打（current / revised / archive，deprecated 由 PDF 内有效期表达）、
`visibility` 5 种全打（public / campus / student / teacher / department）、
`status` 打 ready / archived / draft 三种，其余（processing / failed / offline）靠手工改库或管理端接口造。

## 怎么上传

### 方式一：脚本（推荐）

```bash
# 后端默认 http://127.0.0.1:8080/api/v1
node .\知识库测试数据\upload-knowledge-seed.mjs --token=<管理员 access token> --skip-existing

# 解析器只吃 PDF 时
node .\知识库测试数据\build-pdf.mjs
node .\知识库测试数据\upload-knowledge-seed.mjs --token=<token> --ext=pdf --skip-existing

# 只跑一两篇排查
node .\知识库测试数据\upload-knowledge-seed.mjs --token=<token> --only=01,11
node .\知识库测试数据\upload-knowledge-seed.mjs --dry-run     # 不调接口，只打印
```

脚本只做两件事：`POST /files/presign`（`purpose=knowledge_source`）拿 `file_id`，
再 `POST /knowledge/admin/documents` 建文档。`--skip-existing` 会先拉一遍文档列表按标题去重，
避免撞 `uq_knowledge_documents_no`（`active_document_no` 唯一索引）。

### 方式二：手工两步

```bash
curl -X POST http://127.0.0.1:8080/api/v1/files/presign \
  -H "Authorization: Bearer <token>" \
  -F "file=@知识库测试数据/pdf/01-national-scholarship-2026.pdf;type=application/pdf" \
  -F "filename=01-national-scholarship-2026.pdf" \
  -F "content_type=application/pdf" \
  -F "size_bytes=152756" \
  -F "purpose=knowledge_source"
# → {"data":{"file_id":123,...}}

curl -X POST http://127.0.0.1:8080/api/v1/knowledge/admin/documents \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -H "Idempotency-Key: seed-knowledge-01" \
  -d '{"title":"国家奖学金评选实施细则","document_no":"校学字〔2026〕18号","issuer_id":14,"category_id":7,"visibility":"student","effective_from":"2026-09-01","file_id":123}'
```

`metadata.csv` 的列名与字段一一对应（`issuer_organization_id` → `issuer_id`，`category_id` 已是库内 id）。

### 方式三：直接喂文件目录

后端解析链路如果支持扫目录，把 `docs/`（或 `pdf/`）整个丢进去即可；
Markdown 的 `## 第一章` / `### 第一条（标题）` 就是现成的章节切分点，不必再写切分规则。

## 两个必须知道的坑

1. **01 / 03 / 05 与库内种子文档同文号**（校学字〔2026〕18号 / 校教字〔2026〕12号 / 校学字〔2026〕21号）。
   库里已经有这三篇时直接上传会 **409 撞唯一索引**。要么先清掉种子 29/30/31（它们是这套数据的「对照答案」，重复价值低），
   要么用 `--skip-existing` 跳过。02 与种子 32 同文号，同理。
2. **15 和 16 是刻意的异常样本**：15 是 draft（默认检索不该返回，但治理页要能列出来），
   16 没有文号（`document_no` 为 NULL，唯一索引允许多行 NULL，但后端如果把空串当文号会 409）。
   这两条的报警不是 bug，是数据本身的设计。

## 上传后的验收清单

- [ ] `GET /knowledge/categories` 各分类 `document_count` 增加，且与 metadata.csv 对得上
- [ ] `GET /knowledge/admin/jobs` 16 条作业跑到 `completed`，无 `failed`
- [ ] `GET /knowledge/documents?query=专业前10%` 命中 01（**标题里没有这个词，只有正文有**）
- [ ] `GET /knowledge/documents?query=违章电器` 命中 11；`query=退补选` 命中 03 和 06
- [ ] `GET /knowledge/documents?query=量子计算实验室开放时间` 返回空数组，不是无关文档
- [ ] `GET /knowledge/admin/conflicts` 出现 01↔02、03↔04 两组冲突
- [ ] 学生身份 token 检索 `考试违纪` 无结果（07 是 teacher 可见）
- [ ] 检索 `停车` 无结果（15 未发布），但治理页能看到它
- [ ] 任选一条回答，`message_citations` 的 `document_id / version_id / section_id` 三件套自洽
- [ ] `_html/` 目录**没有**被上传（它不是语料）

逐条判定口径见 `检索验证用例.md`（含负例与分页计数）。
