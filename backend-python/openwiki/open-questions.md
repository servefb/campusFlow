---
type: Open Questions
title: Open questions — campusflow code wiki
description: Unresolved questions about the campusflow repository and this wiki's coverage that would impair future assistance, with owners, evidence, and status.
tags: [open-questions, campusflow, wiki-quality]
---

# Open Questions

## Active

### campusflow-agent-refactor: What is the target topology and control flow of the planner / role / collect agent loop?
- Owner: me
- Seen: 2026-10-08
- Evidence: [agent orchestration](architecture/agent-orchestration.md), [repo state](operations/repo-state.md)
- Notes: The new node, prompt, and findings files are staged-added but deleted in the working tree, so it is unclear whether this design is live work or abandoned staging, and whether `router_agent.py`'s responsibilities moved into `planner_node.py`.

### campusflow-runtime-contracts: Which runtime services does campusflow require, and where are they configured?
- Owner: unknown
- Seen: 2026-10-08
- Evidence: [data and persistence](architecture/data-and-persistence.md), [tools and runtime](architecture/tools-and-runtime.md)
- Notes: MongoDB, Redis, Chroma, MinIO, and an embedding model are implied by module names only. No connection configuration, port, or provider choice is documented, and the staged `.env` must not be read into the wiki.

### campusflow-env-in-git: Is the staged `.env` intentional, and does it hold live credentials?
- Owner: me
- Seen: 2026-10-08
- Evidence: [repo state](operations/repo-state.md)
- Notes: Status `AM .env` with an untracked `.gitignore` means a broad commit could persist secrets. Wiki policy keeps the file's contents out of documentation regardless of the answer.

### campusflow-laya-and-probes: What do the `_laya_*` guard and the `_vision_*` / `_kb_docx_probe.py` scripts target?
- Owner: unknown
- Seen: 2026-10-08
- Evidence: [tools and runtime](architecture/tools-and-runtime.md)
- Notes: `laya_guard.py` reads like a named tool gate, and the vision/docx probes suggest capabilities not represented anywhere in the documented module map.

### campusflow-user-flows: What does campusflow do for a user end to end?
- Owner: unknown
- Seen: 2026-10-08
- Evidence: [architecture overview](architecture/overview.md), [API and runtime](architecture/api-and-runtime.md)
- Notes: Routers and domain names (`conversation`, `worker_space`, `knowledge`, `task_temp`) imply a conversation-centric campus assistant, but no README, request model, or behaviour was readable. This gap limits how much of the architecture can be explained rather than listed.

## Answered

None yet.

## Stale

None yet.
