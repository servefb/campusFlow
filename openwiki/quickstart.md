---
type: Wiki Quickstart
title: campusflow Code Wiki — Quickstart
description: Entry point for the campusflow repository code wiki. Summarizes repository identity, the current Git state, the in-flight agent orchestration refactor, and links to architecture, operations, and source pages.
tags: [campusflow, quickstart, code-wiki, git, architecture]
generated: { by: "openwiki/0.7.1", at: "2026-10-08T02:26:45.567Z" }
---

# campusflow Code Wiki — Quickstart

This wiki documents the **campusflow** repository: its module layout, the architecture changes that are currently in flight, and the Git evidence behind every claim. It is optimized so a future agent can answer architecture questions without re-reading the repository.

## Repository at a glance

| Field | Value | Confidence |
| --- | --- | --- |
| Repo id | `campusflow` | confirmed |
| Local path | `D:\worker-space\campusflow` | confirmed |
| Branch | `master` | confirmed |
| HEAD | `63dff47e961ef5c82363ec816dd37fc0ec85ae4d` (`63dff47 修复了一些`) | confirmed |
| Language / tooling | Python project (`pyproject.toml`, `uv.lock`) | source-backed |
| Working tree | Dirty: 27 tracked entries changed, ~40 untracked paths | confirmed |

Only one commit is visible in the connector manifest (`63dff47`), and it is an initial import that adds the whole project skeleton — `.idea/`, `pyproject.toml`, `src/agent/*`, `src/api/*`, `src/db/*`, `src/repositories/*`, `src/models/*`, `src/main.py`, `test_main.http`. The repository's real architectural history today lives in the **uncommitted working tree**, not in commits.

## Current status

- The working tree is in the middle of a **multi-agent orchestration pivot** (confirmed from file-level Git state). Fixed campus-domain agent nodes and their router are being retired, and a planner / role / collect node set is being introduced. See [agent orchestration](architecture/agent-orchestration.md).
- New integration and persistence seams appeared at the same time: a Mongo-backed agent store (`src/agent/store/mongdb_store.py`) and tool surfaces for MCP and OpenWiki (`src/agent/tools/mcp_tool.py`, `src/agent/tools/openwiki_tool.py`, `src/agent/tools/store_tool.py`). See [tools and runtime](architecture/tools-and-runtime.md).
- Agent-side safety and host-execution infrastructure is new and untracked: `approvals.py`, `permissions.py`, `file_backend.py`, `host_exec.py`, `laya_guard.py`, `submit_answer.py`, `workspace_files.py`. See [tools and runtime](architecture/tools-and-runtime.md).
- The Git state is internally inconsistent: several new architecture files are **staged-added but deleted in the working tree** (`AD src/agent/nodes/planner_node.py`, `role_agent_node.py`, `collect_node.py`, `src/agent/prompt/planner_prompt.py`, `role_prompt.py`, `src/agent/findings.py`). A commit right now would add files that no longer exist on disk. See [repo state and work in flight](operations/repo-state.md).
- `.env` is staged for addition to version control (`AM .env`). This is a secret-handling risk and is tracked as an open question; the wiki never records its contents.

## How this wiki is organized

- [Architecture overview](architecture/overview.md) — the module map and how the packages relate.
- [Agent orchestration](architecture/agent-orchestration.md) — graph, nodes, prompts, state, and the refactor in flight.
- [Data and persistence](architecture/data-and-persistence.md) — `db/`, `repositories/`, `models/`, `schemas/`, and the Mongo store seam.
- [API and runtime](architecture/api-and-runtime.md) — entrypoints, routers, JWT middleware, and API-side changes.
- [Tools and runtime](architecture/tools-and-runtime.md) — tool surfaces, RAG worker, vector store, cache, sandboxes, and permissioning.
- [Repo state and work in flight](operations/repo-state.md) — branch/HEAD/working-tree evidence, hygiene debt, and security notes.
- [Themes](themes.md) — recurring signals across the evidence.
- [Commitments](commitments.md) — in-flight work items inferred from Git state.
- [Open questions](open-questions.md) — unresolved gaps that would impair future assistance.
- [Source evidence: git-repo](sources/git-repo.md) — what the connector provided, and its limits.

## Evidence base and limits

All claims in this wiki come from local Git connector manifests of the `campusflow` repository (`~/.openwiki/connectors/git-repo/raw/2026-10-08T02-26-55-763Z/manifest.json`, plus the earlier `2026-10-08T02-12-30-943Z`, `2026-10-08T02-05-15-271Z`, and `2026-10-08T02-02-19-314Z` runs; all four record identical repo fields, so the working tree was unchanged across the snapshots taken within about twenty-five minutes on 2026-10-08). That evidence contains **paths, Git status codes, branch, HEAD, and changed-file lists only** — no file contents, no dependency declarations, no README, no commit bodies beyond `63dff47 修复了一些`.

Consequences to keep in mind:

- Statements about *what a module contains* are file-level facts.
- Statements about *how modules call each other* are inferences from package layout and naming, marked as such on the page where they appear.
- No runtime behaviour, configuration, database schema, or deployment detail has been verified.

## Backlog

- **Source code reading and `docs/`**: no connector currently returns file contents for this repository, so architecture detail beyond file layout — including whatever the untracked `docs/` tree holds — needs a code-mode run or an additional evidence type.
- **Historical commits**: the manifest exposes only one commit line, so commit-level history and authorship are undocumented.
- **Configuration and environment**: runtime services implied by file names (MongoDB, Redis, Chroma, MinIO) have no verified configuration, ports, or credentials documentation — and `.env` must not be read into the wiki.
- **Other connectors**: not configured (`google`, `notion`, `slack`, `x`, `langsmith`, `custom-mcp` are unauthenticated), so no cross-source project context is available yet.
