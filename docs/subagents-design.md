# CampusFlow 动态子代理设计（v1 草案，2026-09-19）

状态：设计定稿待实现。范围：先只做「联网调研」一个子代理，验收后再议第二个。

---

## 0. 三个源码结论（设计的地基，都已在 .venv 的 deepagents 里核实）

1. **接入形态**：`create_deep_agent(subagents=[SubAgent, ...])` 挂 `SubAgentMiddleware`，
   给主代理加一个 `task(description, subagent_type)` 工具。主代理自行决定何时委派。
   SubAgent 必填 `name / description / model / tools`，可选 `system_prompt / middleware /
   interrupt_on / mode`（mode="fork" 是实验特性，**不用**）。
2. **红线：子代理内的 interrupt 不会上抛。** `subagents.py` 的 `atask` 直接
   `subagent.ainvoke(...)`，全文件没有任何 `__interrupt__` 处理——子代理若配了
   `interrupt_on`，中断会静默丢失，task 工具只拿到空/残缺结果，用户永远看不到卡片。
   ⇒ **子代理 spec 里绝不配 interrupt_on；所有门禁落在父节点对 `task` 工具的
   interrupt_on 上。**
3. **raw SubAgent 没有 backend。** spec 走 `create_agent`（不是 create_deep_agent），
   没有 CompositeBackend——没有 /user/ 文件工具、没有沙箱 execute。
   ⇒ 第一、二期子代理只给纯工具（联网/检索），正好够用；
   第三期数据分析需要沙箱时，改用 `CompiledSubAgent`（自己 create_deep_agent + backend）。

另有两条对我们有利：父 configurable（thread_id / user_folder）自动透传进子代理；
返回值取 `structured_response`（JSON 串）或最后一条非空 AIMessage 文本，作为
ToolMessage 回给主代理。

---

## 1. 第一期：联网调研子代理

### 1.1 为什么是它先做

Tavily 的 raw_content 是网页全文 markdown，主代理搜两三次上下文就被塞满；
且每个联网工具都弹确认卡，一次任务弹 N 张。子代理把「多轮搜索」关进小上下文，
主线只收一段结论。

### 1.2 子代理 spec 草案

| 字段 | 值 |
|---|---|
| name | `research` |
| description | 联网调研：需要查最新外部信息（新闻、版本、政策动态、网页内容）时委派。子代理内部会多轮搜索与抓取，返回一段带来源的结论。 |
| model | `llm_node.get_model(...)` 同款实例 |
| tools | `search / extract / crawl / map_site`（**仅这四个**） |
| system_prompt | 要点：① 你是调研员，围绕 description 把事查清，可多轮 search + extract；② 最终回复=给主代理看的调研报告：结论先行、要点列表、每条结论后附来源 URL；③ 查不到就明说查到了什么、缺什么，不编造；④ 你没有文件工具、不能执行代码、不能直接回复用户。 |
| interrupt_on | **必须不配**（见红线 2） |

### 1.3 工具与门禁的迁移（本次设计的核心）

- **四个联网工具从主代理 tools 移除**，唯一联网入口 = `task`。不留后门——留着的
  话模型会在"想省事"时绕过委派，子代理就白做了。
- 父节点 `interrupt_on`：删掉 search/extract/crawl/map_site 四条，**加 `"task": True`**。
- 权限卡链路全部复用现有机制，只改登记表：
  - `conversations_repo._TOOL_LABELS["task"] = "联网调研"`；
  - `_SUMMARY_ARGS` 加 `"description"`（卡片显示"要调研什么"）；
  - `approvals._IDENTITY_KEYS["task"] = ("subagent_type", "description")`——
    一次批准对应一次委派，重放/换题都变成拒绝。
- 效果：**用户批一张卡（"允许联网调研？<调研目标>"），子代理内部搜十轮不再打扰。**
  弹卡次数从 N 降到 1，这正是本期要的体验收益。

### 1.4 主 prompt 的改动点（common）

- 「八、联网搜索」整节重写：联网一律通过 `task(subagent_type="research", description=…)`
  委派；description 要写清楚调研目标和预期用途（它就是权限卡上用户看的话）；
- `purpose` 相关表述作废（联网工具的 purpose 参数是否保留：**保留**，它现在是
  子代理内部工具调用习惯的锚，但不再上卡片）；
- 新增判断规则：一句话能答、不依赖外部信息 → 直接答，**不要为查证而委派**；
  需要外部信息 → 一律委派，不允许说"我没法联网"；
- `submit_answer` 的出口规则不变（子代理没有这个工具，报告经由主代理提交）。

### 1.5 前端改动点（WebstormProjects/campusflow）

- `PermissionCard.tsx` 的 `ICONS` 加 `task`（Globe 或 Search）；
- ProcessPanel 不需要结构改动：task 的调用/结果就是普通 tool event；
  `args` 里能读到 description，可考虑把它渲染成工具行的摘要（可选，一行改动）。

### 1.6 明确的取舍（v1 接受，v2 再说）

**子代理内部的多轮搜索在过程面板上不可见。** 子代理是 `ainvoke` 起的独立图，
不经过父 `astream(subgraphs=True)`——面板只显示"task 调用 → （一段等待）→ 调研报告"。
v2 可用 langgraph callbacks 把子代理的工具事件转成 `step` 事件下发；v1 先接受。

### 1.7 防呆清单

- `ask_user` / `submit_answer` / `run_on_host` / 文件工具 **绝不进子代理 tools**
  （前两个会破坏交互契约，后两个越权）；
- 子代理循环失控的兜底：它自己的 recursion_limit（默认 25 轮）+ 无 checkpointer
  （状态不落库，task 结果只经 ToolMessage 进主线，天然无残留）。

---

## 2. 第二期：政策/知识检索子代理（第一期验收后启动）

- tools：`retriever_tool / get_knowledge_tool`；同样纯工具、无 interrupt、无 backend；
- system_prompt 强制"结论 + 出处（知识分类/文档 id）"格式；
- 是否也挂 `task` 卡：建议**不挂**——校内知识检索无外泄面，弹卡是纯摩擦；
  门禁只在第一期联网那条。`_IDENTITY_KEYS` 无需登记。

## 3. 第三期（存疑，另议）：数据分析子代理

需要沙箱 backend，raw spec 不支持 ⇒ 必须走 `CompiledSubAgent`（自己
create_deep_agent + CompositeBackend 后作为 runnable 传入）。复杂度跳一个台阶，
等前两期跑顺、且"上下文膨胀"在数据任务上真的痛了再做。

---

## 4. 验收标准（第一期）

1. **上下文**：同一组调研类问题，主对话 messages 的 token 总量对比改造前下降
   （预期显著：raw_content 不再进主线）；
2. **弹卡**：一次多轮调研任务只弹 1 张 task 卡；
3. **完成率**：模型对新信息类问题不再绕过/拒绝（真机抽样 10 条）；
4. **门禁回归**：`_host_exec_selftest.py` 通过 + 权限作答续跑不回归
   （resume 路径碰 task 卡的场景手测一次）。

## 5. 风险清单

| 风险 | 缓解 |
|---|---|
| 模型不用 task，直接答"不知道" | prompt 强规则 + tools 里没有联网工具（物理绕不过） |
| 子代理空转/超长等待 | recursion_limit 兜底；报告格式写进子 prompt；主代理收到空报告可重派一次 |
| 每次委派多一套系统 prompt 的 token 成本 | 子代理 prompt 控制在几百字；相比省下的 raw_content 远远划算 |
| task 卡被拒后的行为未定义 | prompt 写明：被拒 = 本轮不联网，改用已有知识作答并声明局限 |
