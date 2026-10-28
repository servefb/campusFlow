---
type: Architecture Overview
title: campusflow architecture overview
description: Module map for the campusflow repository — entrypoints, HTTP routers, the LangGraph-style agent runtime, tools, repositories, database modules, cache, vector store, RAG worker, and sandboxes — with the current refactor direction.
tags: [campusflow, architecture, module-map, overview]
---

# campusflow architecture overview

**Evidence class:** file-level. Every path below is confirmed by the git-repo manifest; the wiring between layers is inferred from package layout and is labelled `source-backed`, not verified from source code.

## Package map

| Area | Path | Role as evidenced by path |
| --- | --- | --- |
| Entrypoints | `src/main.py`, `src/my_project.py`, `run.py` (untracked) | Application startup and an ad-hoc run script. |
| HTTP layer | `src/api/*` | Feature routers: `conversation_router.py`, `worker_space.py`, `history_router.py`, `task_temp_agent.py`, plus new `audit.py`, `health_router.py`, `knowledge_router.py`. `agent_router.py` is being removed. |
| Auth | `src/jwt/JWTAuthMiddleware.py` | JWT middleware guarding the API. |
| Agent runtime | `src/agent/*`, `src/graph/create_Graph.py` | Multi-agent orchestration: nodes, prompts, shared state, LLM node, tools, sandbox, RAG worker, vector store, cache, embedding model. |
| Agent store | `src/agent/store/mongdb_store.py` (new) | Mongo-backed persistence seam used by agent tools. |
| Tool surfaces | `src/agent/tools/*` | Knowledge retrieval, search, task info, plus new MCP, OpenWiki, store, host-exec, workspace-file, submit-answer, and guard tools. |
| Data access | `src/repositories/*` | Repository layer over the `db/` modules: `conversations_repo.py`, `worker_space_repo.py`, `tasks_templates_match.py`, plus new `workspace_browse_repo.py`. `agent_repo.py` is being removed. |
| Database | `src/db/*` | Per-domain DB modules (`db_user`, `db_conversation`, `db_message`, `db_Knowledge`, `db_quick_entries`, `db_task_temp`, `db_base`, `basic_config`) plus new `db_organization.py` and `mongo_proxy.py`. `db_agent.py` is being removed. |
| Contracts | `src/models/*`, `src/schemas/send_messages.py` | Response and message models. `models/worker_space_res.py` is being removed. |
| Retrieval | `src/agent/rag_worker/*`, `src/agent/vectorstore/chroma_vectorstore.py`, `src/agent/embedding_model/embedding_alli_model.py` | Document chunking, extraction, MinIO object access, and a Chroma vector store. |
| Cache | `src/cache/redis_client.py`, `src/agent/cache/redis_cache.py` | Redis client and an agent-level cache wrapper. |
| Execution | `src/agent/sandbox/eab_sandbox.py`, `src/agent/sandbox/open_sandbox.py` | Two sandbox implementations used for agent-run code or tool execution. |

## Module map as a diagram

```mermaid
flowchart TD
  subgraph Entry["Entrypoints"]
    main["src/main.py"]
    runpy["run.py — untracked"]
    myproject["src/my_project.py"]
  end
  subgraph HTTP["HTTP layer"]
    apirouters["src/api routers"]
    jwtmid["src/jwt/JWTAuthMiddleware.py"]
  end
  subgraph AgentRuntime["Agent runtime"]
    graphbuild["src/graph/create_Graph.py"]
    agentnodes["src/agent/nodes"]
    agentprompts["src/agent/prompt"]
    agentstate["src/agent/state/common_state.py"]
    llmnode["src/agent/llm/llm_node.py"]
    agenttools["src/agent/tools"]
    agentstore["src/agent/store/mongdb_store.py"]
    sandbox ["src/agent/sandbox"]
  end
  subgraph Support["Support services"]
    repos["src/repositories"]
    dbmods["src/db"]
    redis["Redis client and cache"]
    chroma["Chroma vector store"]
    ragworker["src/agent/rag_worker"]
    minio["MinIO object access"]
  end
  main --> jwtmid
  jwtmid --> apirouters
  apirouters --> graphbuild
  apirouters --> repos
  graphbuild --> agentnodes
  agentnodes --> agentprompts
  agentnodes --> llmnode
  agentnodes --> agenttools
  agentnodes --> agentstate
  agentnodes --> sandbox
  agenttools --> agentstore
  agenttools --> ragworker
  ragworker --> chroma
  ragworker --> minio
  repos --> dbmods
  agentnodes --> redis
```

Module map derived from file paths in the git-repo manifest; solid edges show the wiring this layout implies, not verified call order.

## What the current change set says about direction

Three movements are visible in the tracked change set and the untracked additions:

1. **From fixed domain agents to a generic node loop.** `router_agent.py`, `router_prompt.py`, and the `academic` / `policy` / `workflow` agent nodes and prompts are deleted, while `planner_node.py`, `role_agent_node.py`, `collect_node.py`, `planner_prompt.py`, and `role_prompt.py` are staged as additions. See [agent orchestration](agent-orchestration.md).
2. **An explicit persistence and capability layer for agents.** `store/mongdb_store.py`, `tools/store_tool.py`, `tools/mcp_tool.py`, and `tools/openwiki_tool.py` are new and carry unstaged modifications on top of their staged content.
3. **Agent safety and host access.** `approvals.py`, `permissions.py`, `file_backend.py`, `host_exec.py`, `laya_guard.py`, `submit_answer.py`, `workspace_files.py`, and `prompt/subagent_prompts.py` are new untracked modules, accompanied by root-level probe scripts (`_shell_cap_probe.py`, `_subagent_perms_selftest.py`, `_laya_toolgate_probe.py`). See [tools and runtime](tools-and-runtime.md).

## Cross-cutting relationships

- The HTTP layer is expected to reach the agent runtime through the graph builder at `src/graph/create_Graph.py` and separately reach the data layer through `src/repositories/*`; removal of `src/api/agent_router.py` narrows the agent-facing HTTP surface. Details in [API and runtime](api-and-runtime.md).
- `src/repositories/*` is the only evidenced data-access boundary in front of `src/db/*`; the agent store at `src/agent/store/mongdb_store.py` and the new `src/db/mongo_proxy.py` are a parallel path specific to agent state. Details in [data and persistence](data-and-persistence.md).
- Tools consume both the agent store and the retrieval stack, which is why `tools/` and `rag_worker/` are documented together in [tools and runtime](tools-and-runtime.md).

## Related pages

- [Agent orchestration](agent-orchestration.md)
- [Data and persistence](data-and-persistence.md)
- [API and runtime](api-and-runtime.md)
- [Tools and runtime](tools-and-runtime.md)
- [Repo state and work in flight](../operations/repo-state.md)
- [Source evidence: git-repo](../sources/git-repo.md)
