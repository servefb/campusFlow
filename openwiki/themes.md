---
type: Theme Index
title: Recurring themes — campusflow code wiki
description: Compact index of recurring architectural signals in the campusflow repository, derived from local Git manifest evidence with confidence labels and links to detail pages.
tags: [themes, campusflow, index, architecture]
generated: { by: "openwiki/0.7.1", at: "2026-10-08T02:26:45.567Z" }
---

# Recurring themes — campusflow code wiki

Index only. Detail, examples, and file inventories live on the linked pages. Every theme below comes from a single source (`git-repo`) and a single evidence window (2026-10-08), so first-seen and last-seen dates are both the manifest date.

| Topic key | Theme / Signal | First seen | Last seen | Confidence | Sources | Evidence count | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `agent-orchestration-pivot` | Router plus campus-domain agent nodes are being replaced by planner / role / collect nodes and prompts | 2026-10-08 | 2026-10-08 | source-backed | git-repo | 4 runs, 1 repo | Active | [agent orchestration](architecture/agent-orchestration.md) |
| `agent-tooling-expansion` | Agent gains external bridges (`mcp_tool`, `openwiki_tool`) and state-changing tools (`store_tool`, `workspace_files`, `submit_answer`) | 2026-10-08 | 2026-10-08 | source-backed | git-repo | 4 runs, 1 repo | Active | [tools and runtime](architecture/tools-and-runtime.md) |
| `agent-safety-gating` | New permission, approval, file-backend, and guard modules appear with host execution and sandboxes | 2026-10-08 | 2026-10-08 | source-backed | git-repo | 4 runs, 1 repo | Active | [tools and runtime](architecture/tools-and-runtime.md) |
| `mongo-persistence-shift` | Agent-specific relational path is deleted while a Mongo proxy and agent store are added | 2026-10-08 | 2026-10-08 | source-backed | git-repo | 4 runs, 1 repo | Active | [data and persistence](architecture/data-and-persistence.md) |
| `rag-ingestion-wiring` | New `rag_worker/ingest_service.py` and `api/knowledge_router.py` around an unchanged chunk / embed / Chroma stack | 2026-10-08 | 2026-10-08 | source-backed | git-repo | 4 runs, 1 repo | Active | [tools and runtime](architecture/tools-and-runtime.md) |
| `repo-hygiene-debt` | ~20 root probe scripts, two legacy trees, a backup tree, and a staged `.env` sit untracked next to the refactor | 2026-10-08 | 2026-10-08 | confirmed for paths, watchlist for intent | git-repo | 4 runs, 1 repo | Active | [repo state](operations/repo-state.md) |
| `file-level-evidence-limit` | All wiki claims so far are path- and status-level; no file contents, commit history, or runtime contract is verifiable | 2026-10-08 | 2026-10-08 | confirmed | git-repo | 4 runs, 1 repo | Active | [source evidence](sources/git-repo.md) |

Notes:

- Promote a theme only when it recurs or gains a second source; with one source configured, all rows remain within a single evidence window.
- `repo-hygiene-debt` is the only theme with a security dimension (`.env` staged for commit, see [open questions](open-questions.md) under `campusflow-env-in-git`).
