# Files

- [Agent orchestration in campusflow](agent-orchestration.md) - The campusflow agent runtime — graph builder, node set, prompts, shared state, LLM node, and the in-flight pivot from a router-driven domain agent set to planner, role, and collect nodes.
- [API and runtime surface in campusflow](api-and-runtime.md) - campusflow HTTP surface and entrypoints — FastAPI-style routers, JWT auth middleware, main.py and run.py startup, and the router additions and removals in the current change set.
- [Data and persistence in campusflow](data-and-persistence.md) - campusflow data layer — db modules, repository classes, models and schemas, the Mongo proxy and agent store seam, plus the Redis, Chroma, and MinIO services implied by the change set.
- [campusflow architecture overview](overview.md) - Module map for the campusflow repository — entrypoints, HTTP routers, the LangGraph-style agent runtime, tools, repositories, database modules, cache, vector store, RAG worker, and sandboxes — with the current refactor direction.
- [Tools, retrieval, and agent runtime services in campusflow](tools-and-runtime.md) - campusflow agent tool surfaces, permission and approval gating, host execution and sandboxes, the RAG worker with Chroma and MinIO, Redis caching, MCP and OpenWiki integrations, and the probe/legacy files at the repo root.
