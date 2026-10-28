---
type: Source Evidence
title: Source evidence — Local Git repositories (git-repo, campusflow)
description: Compact evidence notes for the git-repo connector run covering the campusflow repository, including raw manifest paths, recorded Git state, coverage limits, and how the evidence was used.
tags: [source, git-repo, campusflow, evidence]
generated: { by: "openwiki/0.7.1", at: "2026-10-08T02:26:45.567Z" }
---

# Source evidence — Local Git repositories (git-repo, campusflow)

## Connector facts

| Field | Value |
| --- | --- |
| Connector id | `git-repo` |
| Backend | local Git manifests (read-only, no network) |
| Config path | `C:\Users\Lenovo\.openwiki\connectors\git-repo\config.json` |
| Raw dir | `C:\Users\Lenovo\.openwiki\connectors\git-repo\raw` |
| Required env | none |
| Repos configured | 1 (`campusflow`); the scheduled run label for this source is "Local Git repository 2" |

## Run coverage

| Run id | File | Notes |
| --- | --- | --- |
| `2026-10-08T02-02-19-314Z` | `manifest.json` | Pre-run manifest; `status` in run metadata was recorded as interrupted. |
| `2026-10-08T02-05-15-271Z` | `manifest.json` | Refreshed during the earlier update run. Content identical to the earlier run for all recorded fields. |
| `2026-10-08T02-12-30-943Z` | `manifest.json` | Earlier run; superseded by the `02:26` run below. `generatedAt` = `2026-10-08T02:12:32.028Z`. |
| `2026-10-08T02-26-55-763Z` | `manifest.json` | Latest run and the evidence for this update (connector `generatedAt` = `2026-10-08T02:26:57.117Z`). Same `head`, `branch`, `changedFiles`, `recentCommits`, and `status` values as all three earlier runs, so no repository change occurred in the last 24 hours. |

All four manifests contain a single repo record (`campusflow`) with the same `head`, `branch`, `changedFiles`, `recentCommits`, and `status` values; only the connector's `generatedAt` stamp differs. The uncommitted working tree was therefore stable across four snapshots taken within about twenty-five minutes on 2026-10-08, so every architecture claim in this wiki still describes that same state — notably, the six `AD` (staged-add / worktree-deleted) files had not been resolved in that window. The latest run added no durable knowledge beyond extending that stability window, so no canonical page's substance changed.

## Recorded repository state

- `id`: `campusflow`; `path`: `D:\worker-space\campusflow`; `branch`: `master`
- `head`: `63dff47e961ef5c82363ec816dd37fc0ec85ae4d` — the only commit line reported, message `修复了一些`
- `changedFiles`: 27 entries — `A .env`; modified `pyproject.toml`, `src/agent/llm/llm_node.py`, `src/agent/nodes/campusflow_agent_node.py`, `src/agent/prompt/common_agent_prompt.py`, `src/agent/state/common_state.py`, `src/api/conversation_router.py`, `src/api/worker_space.py`, `src/db/db_user.py`, `src/graph/create_Graph.py`, `src/main.py`, `src/repositories/conversations_repo.py`, `src/repositories/worker_space_repo.py`; deleted agent nodes `academic_agent_node.py`, `policy_agent_node.py`, `workflow_agent_node.py`; deleted `src/agent/prompt/router_prompt.py`, `src/agent/prompt/workflow_agent_prompt.py`, `src/agent/router_agent.py`, `src/api/agent_router.py`, `src/db/db_agent.py`, `src/models/worker_space_res.py`, `src/repositories/agent_repo.py`; added `src/agent/store/mongdb_store.py`, `src/agent/tools/{mcp_tool,openwiki_tool,store_tool}.py`
- `status`: full porcelain output — see [repo state and work in flight](../operations/repo-state.md) for the decoded inventory

## What this evidence does and does not support

Supported directly (confirmed):

- Branch, HEAD hash and message, tracked-file change set, index/worktree status codes, untracked path list, and the single import commit's file list.

Not supported by this source:

- File contents, dependency graphs, runtime call order, configuration values, database schemas, test results, and any commit history beyond `63dff47`.
- Nothing was read from `.env`; its presence in `status` is recorded only as a staging state, never as content.

Inference policy used on the canonical pages: structural claims are written from paths and Git status (confirmed), while relationships between modules are phrased as "consistent with" or "inferred from layout" and labelled `source-backed`.

## Where this evidence is synthesized

- [Architecture overview](../architecture/overview.md) — module map.
- [Agent orchestration](../architecture/agent-orchestration.md) — node/prompt/state changes.
- [Data and persistence](../architecture/data-and-persistence.md) — `db/`, `repositories/`, `store/`.
- [API and runtime](../architecture/api-and-runtime.md) — routers and entrypoints.
- [Tools and runtime](../architecture/tools-and-runtime.md) — tools, RAG, cache, sandbox, permissions.
- [Repo state and work in flight](../operations/repo-state.md) — Git status decode and hygiene.
- [Themes](../themes.md), [Commitments](../commitments.md), [Open questions](../open-questions.md) — cross-cutting synthesis.
