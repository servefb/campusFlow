---
type: Commitments
title: Commitments and work in flight
description: Concrete work items and follow-ups inferred from campusflow Git state, with owners, evidence, and confidence labels.
tags: [commitments, campusflow, follow-ups]
---

# Commitments and work in flight

Only one source is available for this wiki (local Git state), so these items are inferred from the working tree rather than stated by a person. Each row carries a confidence label; none of these are confirmed by a written commitment.

## Active

| Item | Owner | Evidence | Confidence | Status |
| --- | --- | --- | --- | --- |
| Finish or revert the agent orchestration pivot: resolve the six `AD` files (`planner_node.py`, `role_agent_node.py`, `collect_node.py`, `planner_prompt.py`, `role_prompt.py`, `findings.py`) so the index and working tree agree | me | `git status` porcelain in [repo state](operations/repo-state.md) | confirmed that the inconsistency exists; owner inferred from local uncommitted work | open |
| Decide what happens to `.env`: it is staged (`AM .env`) while `.gitignore` is still untracked | unknown | [repo state](operations/repo-state.md), secret-handling note | confirmed staging state, intent unknown | open, security-sensitive |
| Wire the new tool seams (`mcp_tool`, `openwiki_tool`, `store_tool`) and their gating (`permissions.py`, `approvals.py`, `laya_guard.py`) into the node loop | me | new untracked modules plus `AM` staged tool files in [tools and runtime](architecture/tools-and-runtime.md) | source-backed | in progress |
| Retire the agent-specific persistence path: `agent_repo.py`, `db_agent.py`, `models/worker_space_res.py` are being deleted while `db/mongo_proxy.py`, `db/db_organization.py`, and `agent/store/mongdb_store.py` are added | me | changed-file and status sets in [data and persistence](architecture/data-and-persistence.md) | source-backed | in progress |
| Add a `.gitignore` before the next broad `git add` so probe scripts, legacy trees, backups, and local tool directories stay out of history | me | ~40 untracked paths including `.gitignore` itself in [repo state](operations/repo-state.md) | source-backed | open |
| Clean up or relocate the root probe/self-test scripts (`_laya_*`, `_vision_*`, `_shell_cap_probe.py`, `_subagent_perms_selftest.py`, `_kb_docx_probe.py`) and the retired `_legacy_mq/`, `_legacy_multi_agent/` trees | me | untracked path list in [tools and runtime](architecture/tools-and-runtime.md) | watchlist | open |

## Scheduled or time-bound items

None. This source contains no dates, meetings, or deadlines — the only date-like values are the manifest timestamps and the `.backup-20260915/` directory name.

## Related pages

- [Repo state and work in flight](operations/repo-state.md)
- [Open questions](open-questions.md)
- [Themes](themes.md)
