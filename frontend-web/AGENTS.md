# Repository Guidelines

## Project Structure

This repository is a React 18 + TypeScript + Vite frontend for Campus Flow. Runtime code is under `src/`:

- `src/app/`: routing, shell, and protected-route boundaries.
- `src/pages/`: route-level screens.
- `src/components/`: shared UI primitives.
- `src/services/`: Axios API clients; every business request belongs here.
- `src/types/`: shared API and domain types.
- `src/stores/`: Zustand session state.
- `src/styles/`: global and page styles.
- `public/`: static assets. `dist/` is generated and should not be edited.

The SQL source of truth is `校园事务智能助手数据库设计.sql`. API behavior is documented in `校园事务智能助手后端接口文档.md`.

## Build, Test, and Development

Use Node.js 20+ and pnpm 9+.

- `pnpm install`: install locked dependencies.
- `pnpm dev`: start the Vite development server.
- `pnpm build`: run TypeScript project builds and create `dist/`.
- `pnpm preview`: serve the production build locally.
- `pnpm lint`: run the ESLint configuration.
- `pnpm test`: run Vitest tests when test files are present.

Set `VITE_API_BASE_URL` to the backend's `/api/v1` base URL. Do not enable mock data or add local demo accounts.

## Coding Style

Use two-space indentation, single quotes, semicolons only when required by syntax, and TypeScript types for API boundaries. Use PascalCase for React components, camelCase for functions and variables, and kebab-case only for CSS class names. Keep HTTP calls in `src/services/`; pages should handle loading, error, and empty states rather than embedding fallback records.

## Testing Guidelines

Prefer focused Vitest tests for service parameter serialization and component states. Name files `*.test.ts` or `*.test.tsx`. Every API-backed screen should cover loading, successful data, empty data, and failed-request states.

## Commits and Pull Requests

Use short imperative commits such as `wire tasks page to API` or `update task contract docs`. Pull requests should describe the affected routes and API endpoints, include validation commands, mention database/schema changes, and attach screenshots for visual changes. Never commit access tokens, passwords, generated `dist/` output, or real student data.
