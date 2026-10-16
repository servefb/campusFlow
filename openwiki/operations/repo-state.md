---
type: Operations Reference
title: campusflow repo state and work in flight
description: Git evidence for the campusflow repository as of the latest git-repo manifest — branch, HEAD, the single import commit, a decoded dirty working tree, the staged-versus-worktree inconsistency, and hygiene and secret-handling notes.
tags: [campusflow, operations, git, repo-state, hygiene]
generated: { by: "openwiki/0.7.1", at: "2026-10-08T02:26:45.567Z" }
---

# campusflow repo state and work in flight

**Evidence class:** confirmed — this page restates the latest git-repo manifest (`2026-10-08T02-26-55-763Z/manifest.json`, connector `generatedAt` `2026-10-08T02:26:57.117Z`), whose recorded repo fields are byte-identical to the earlier `2026-10-08T02-12-30-943Z`, `2026-10-08T02-05-15-271Z`, and `2026-10-08T02-02-19-314Z` runs.

## Current state

| Field | Value |
| --- | --- |
| Repo | `campusflow` at `D:\worker-space\campusflow` |
| Branch | `master` |
| HEAD | `63dff47e961ef5c82363ec816dd37fc0ec85ae4d` |
| HEAD message | `63dff47 修复了一些` |
| Commits visible in evidence | 1 |
| Tracked entries changed | 27 |
| Untracked paths | ~40 |

The single visible commit is an initial import: it adds `.idea/` project files, `pyproject.toml`, the full `src/agent`, `src/api`, `src/db`, `src/repositories`, `src/models`, and `src/schemas` trees, `src/main.py`, `src/my_project.py`, `src/jwt/JWTAuthMiddleware.py`, and `test_main.http`. Its message (`修复了一些`, "fixed something") does not describe the import, and no earlier commit is exposed. Commit history is therefore not a usable architectural source for this repository; the working tree is.

## Dirty working tree, decoded

Git porcelain shows staged (`X`) and worktree (`Y`) status separately. Reading the manifest that way:

**Staged changes (`X` set), i.e. already in the index:**

| Code | Paths |
| --- | --- |
| `D` (staged delete) | `src/agent/nodes/academic_agent_node.py`, `src/agent/nodes/policy_agent_node.py`, `src/agent/prompt/router_prompt.py`, `src/agent/router_agent.py`, `src/api/agent_router.py`, `src/repositories/agent_repo.py` |
| `A` (staged add) | `.env`, `src/agent/store/mongdb_store.py`, `src/agent/tools/mcp_tool.py`, `src/agent/tools/openwiki_tool.py`, `src/agent/tools/store_tool.py`, plus the `AD` set below |
| `AD` (staged add, deleted in worktree) | `src/agent/findings.py`, `src/agent/nodes/planner_node.py`, `src/agent/nodes/role_agent_node.py`, `src/agent/nodes/collect_node.py`, `src/agent/prompt/planner_prompt.py`, `src/agent/prompt/role_prompt.py` |
| `AM` (staged add, modified after) | `.env`, `src/agent/store/mongdb_store.py`, `src/agent/tools/mcp_tool.py`, `src/agent/tools/openwiki_tool.py`, `src/agent/tools/store_tool.py` |

**Unstaged changes (`Y` set), i.e. only in the working tree:**

| Code | Paths |
| --- | --- |
| `M` | `pyproject.toml`, `src/agent/llm/llm_node.py`, `src/agent/nodes/campusflow_agent_node.py`, `src/agent/prompt/common_agent_prompt.py`, `src/agent/state/common_state.py`, `src/api/conversation_router.py`, `src/api/worker_space.py`, `src/db/db_user.py`, `src/graph/create_Graph.py`, `src/main.py`, `src/repositories/conversations_repo.py`, `src/repositories/worker_space_repo.py` |
| `D` | `src/agent/nodes/workflow_agent_node.py`, `src/agent/prompt/workflow_agent_prompt.py`, `src/db/db_agent.py`, `src/models/worker_space_res.py` |

**Untracked (`??`) groups:** `.backup-20260915/`, `.github/`, `.gitignore`, `.workbuddy/`, `AGENTS.md`, `docs/`, `openwiki/`, `run.py`, `uv.lock`, the `_laya_*` / `_vision_*` / `_shell_cap_probe.py` / `_subagent_perms_selftest.py` / `_kb_docx_probe.py` probe scripts, the retired `_legacy_mq/` and `_legacy_multi_agent/` trees, and these new source modules: `src/agent/approvals.py`, `src/agent/file_backend.py`, `src/agent/history_utils.py`, `src/agent/llm/chat_model.py`, `src/agent/permissions.py`, `src/agent/prompt/subagent_prompts.py`, `src/agent/rag_worker/ingest_service.py`, `src/agent/supplement_inject.py`, `src/agent/tools/host_exec.py`, `src/agent/tools/laya_guard.py`, `src/agent/tools/submit_answer.py`, `src/agent/tools/workspace_files.py`, `src/api/audit.py`, `src/api/health_router.py`, `src/api/knowledge_router.py`, `src/db/db_organization.py`, `src/db/mongo_proxy.py`, `src/repositories/workspace_browse_repo.py`.

## Risks and follow-ups in this state

1. **Index and disk disagree on the new architecture.** The `AD` files are in the index but not on disk. A commit right now would add `planner_node.py`, `role_agent_node.py`, `collect_node.py`, `planner_prompt.py`, `role_prompt.py`, and `findings.py` to the repository while the working tree cannot import them. Either the staged version represents real work that was removed locally, or the staging is leftover from an abandoned attempt — the evidence cannot distinguish these.
2. **`.env` is staged for version control.** Status `AM .env` means a dotenv file was added to the index and then modified in the working tree. If it contains live credentials, committing it would leak secrets into history. The wiki does not read, quote, or summarize that file; only its staging state is recorded. See [open questions](../open-questions.md) under `campusflow-env-in-git`.
3. **Hygiene debt at the repo root.** Roughly twenty `_*probe*.py` / `_*selftest*.py` scripts, two retired trees (`_legacy_mq/`, `_legacy_multi_agent/`), a dated backup tree (`.backup-20260915/`), and local tool directories (`.workbuddy/`, `openwiki/`) are all untracked. Without a `.gitignore` covering them — `.gitignore` is itself still untracked — a broad `git add` would fold debugging artifacts and possibly secrets into the first real commit.
4. **Only one commit, high drift.** 27 changed tracked entries plus ~40 untracked paths against a single import commit means the commit graph carries almost no architectural information. Regenerating architecture notes requires reading the working tree, not history.

## Why this matters for the wiki

The [agent orchestration](../architecture/agent-orchestration.md) pivot, the [store and tool additions](../architecture/tools-and-runtime.md), and the [data-layer changes](../architecture/data-and-persistence.md) are all uncommitted. Any statement in this wiki about campusflow's architecture describes the working tree at the latest manifest timestamp (`2026-10-08T02:26:57Z`) and can change without a commit.

## Related pages

- [Source evidence: git-repo](../sources/git-repo.md)
- [Architecture overview](../architecture/overview.md)
- [Commitments](../commitments.md)
- [Open questions](../open-questions.md)
