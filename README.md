# CampusFlow · 校园脉络

校园事务多智能体助手。仓库按 **monorepo** 组织，四个子项目各占一个目录，互不干扰。

| 目录 | 项目 | 技术栈 | 原分支 |
|---|---|---|---|
| `frontend-web/` | 用户端 Web（师生侧协作工作台） | React 18 · TypeScript · Vite · Zustand | `frontend-web` |
| `frontend-admin/` | 管理端控制台（知识库治理 / 运行监控 / 审计） | React 19 · TypeScript · Vite · React Query | `main` |
| `backend-python/` | AI Agent 服务（LangGraph / deepagents / RAG） | Python 3.13 · FastAPI · LangGraph · Chroma · uv | `backend-python` + 旧 `master` |
| `backend-java/` | 业务后端（Maven 多模块：common / tools / service） | Java · Spring Boot 3 · MyBatis-Plus · Flyway · JWT | `backend-java` |

## 目录约定

```
campusflow/
├── frontend-web/      # 用户端
├── frontend-admin/    # 管理端
├── backend-python/    # Agent 服务
└── backend-java/      # 业务后端
```

每个子目录保留各自的 `package.json` / `pom.xml` / `pyproject.toml` 与 `.gitignore`，构建、测试、部署命令在该目录内执行，与合并前一致。

## 本地启动

```bash
# 用户端前端（pnpm）
cd frontend-web && pnpm install && pnpm dev

# 管理端前端（npm）
cd frontend-admin && npm install && npm run dev

# Python Agent 服务（uv 管理依赖；Windows 下请用 run.py 启动，不要裸起 uvicorn）
cd backend-python
uv sync
cp .env.example .env      # 填入 LLM 网关、Redis/PG/Mongo/MinIO/RabbitMQ 等
python run.py             # 监听 http://127.0.0.1:8000，健康检查 /health

# Java 业务后端（标准 Maven；Git Bash 下用仓库自带的 _mvn.sh 包装脚本绕开 MSYS 路径问题）
cd backend-java && ./_mvn.sh clean package
```

各服务端口、接口与相互调用关系见各子目录内的 `README.md`。

## 仓库历史说明

本仓库由四个独立项目合并而来（2026-10），各自没有共同祖先，通过 subtree 方式接入同一条历史：

- 根提交是一条空提交，每个子目录的第一个提交是对应来源分支的合并提交。
- 合并前的全部提交都完整保留在仓库中，并打有归档 tag：`archive/frontend-web`、`archive/frontend-admin`、`archive/backend-python`、`archive/backend-java`。
- 由于合并前后文件路径发生了变化（如 `src/agent` → `backend-python/src/agent`），`git log -- backend-python/` 只能追溯到合并点。要查看合并前的历史，请用 tag 入口：

```bash
git log --oneline archive/backend-python       # Agent 服务合并前的完整历史
git log --oneline archive/backend-java         # 业务后端合并前的完整历史
git log --follow -- backend-python/src/main.py # 单个文件可跨合并点追溯
```
