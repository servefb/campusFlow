# _legacy_multi_agent —— 已淘汰的「节点编排」多智能体方案

归档于 2026-09-23。**当前不在任何图里，import 也进不来**（目录无 `__init__.py`，且
`src/` 下已无引用）。留着只为"将来想捡回来"时有原文可抄 —— 仓库至今没有任何 commit，
删掉就真的没了（见 `.workbuddy/memory/MEMORY.md` 的硬约束：淘汰代码走归档不要删）。

## 为什么淘汰

方案是「手搓节点图」：planner 拆解 → 角色节点并行跑 → collect 汇总判据 → synthesis 出答复。
它被放弃的原因是**成本远大于收益**：

- 要保证「用户只看到一份答复」必须自己造 synthesis 节点，而 `submit_answer` 是
  `return_direct` 工具（调用即收尾、前端边流边推打字机），于是所有校验只能前置，
  等于把 Verifier 硬塞进 collect 的纯代码判据里 —— 复杂度全压在自制管线上。
- deepagents 原生就有这套能力：`create_deep_agent(subagents=[...])` + `task` 工具，
  框架的 `task` 描述原话写着 "The agent's report is not shown to the user; relay a summary
  yourself."，即「用户只看到主智能体整合的一份答复」是**框架语义**，不用自制。
- 代价是编排确定性交给模型（同一问题两次拆法可能不同），这个代价被接受 —— 校园场景
  5 个子智能体以内、松耦合，划算。

现在生效的是 `src/agent/nodes/campusflow_agent_node.py`（主智能体 + 5 个子智能体），
子智能体由 deepagents 托管，**不进图**。

## 各文件原是干什么的

| 文件 | 原职责 | 为什么不再需要 |
| --- | --- | --- |
| `nodes/planner_node.py` | 入口节点：调 **laya** 决策原语判 direct / collaborate，collaborate 时把问题拆成子任务并 `Send` 给角色节点 | 主智能体自己就是编排者，`Send` 换成了 `task` |
| `nodes/role_agent_node.py` | 角色节点工厂：按 role 名造节点，只出 Findings（绝不进 messages），走 `get_structured_model` 关思考 | 子智能体的 `system_prompt` + `tools` 已按角色分开 |
| `nodes/collect_node.py` | 黑板合并 + 纯代码 gate（查缺漏 / 冲突 / 无源 / 低置信），**从未写过一个字节**（0 字节空文件） | 判据挂不到子代理上：`SubAgent` spec 没有 `response_format` 字段，只能出自由文本报告 |
| `prompt/planner_prompt.py` | planner 的拆解提示词（写死了 direct / collaborate 双轨判据） | 双轨取消，统一由主智能体编排 |
| `prompt/role_prompt.py` | `ROLE_NAMES` / `ROLE_PROMPT`（`{role}` 单占位符） | 提示词已移到 `src/agent/prompt/subagent_prompts.py` |
| `findings.py` | `Claim`/`Finding`/`SubTask`/`Plan` + `merge_findings`（黑板 reducer）+ `evaluate_findings`（纯代码 gate） | 同上：这层结构化材料在子代理路线上没有落点（成了软约束写进 prompt） |
| `nodes/workflow_agent_node.py` | 更早一代的「事务流转」独立节点：不带沙箱、可写、`interrupt_on={"run_on_host": True}`、持有 `submit_answer` | 图里只剩主智能体一个节点后，它是第二个出口 —— 两个出口＝两套收尾。办事项领域已由子智能体 `workflow` 承接 |
| `prompt/workflow_agent_prompt.py` | 上面那个节点的提示词（`WORK_FLOW_PROMPT`，13 KB：创建任务 / 核验材料 / 跟踪节点 / 补充取消的细则） | 随节点一起下线。⚠️ 子智能体版 `WORKFLOW_SUBAGENT_PROMPT` 只覆盖「怎么办」与工单查询，**没有**这 13 KB 里的实操细则 —— 需要时从这里搬 |

## 想捡回来时要注意

- `findings.py` 的 `merge_findings` 是给 state 通道当 reducer 用的（`Annotated[list, reducer]`），
  当时 `MultiAgentState` 上有 `findings` / `plan` / `rounds` / `gate_report` / `final_report`
  等通道；**这些通道已随本次归档从 `common_state.py` 删掉**，捡回来要一起补。
- `planner_node.py` 里的 **laya** 决策原语（`from laya import Router`）是用户特意保留的一段，
  归档时原样搬过来，没改一行（含"返回值暂时没用"这一点）。laya 包仍在 `.venv` 里。
- 老 checkpoint 里可能还存着 `plan` / `findings` 等通道的值，schema 已无这些键，
  LangGraph 会直接忽略，不会报错。
