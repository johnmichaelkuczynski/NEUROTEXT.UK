# NEUROTEXT

NEUROTEXT is a multi-model AI evaluation and generation workspace for inspecting, strengthening, and transforming long-form writing.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/neurotext/src/pages/workspace.tsx` — primary workspace experience
- `artifacts/neurotext/src/pages/history.tsx` — persistent generation archive
- `artifacts/neurotext/src/pages/settings.tsx` — provider and evaluation preferences
- `artifacts/neurotext/src/components/neuro-shell.tsx` — shared application shell
- `artifacts/api-server/src/routes/workspace.ts` — workspace, document, and generation job endpoints
- `lib/api-spec/openapi.yaml` — source of truth for API contracts

## Architecture decisions

- The first build uses a typed OpenAPI contract and generated React Query hooks so the UI and API share request/response shapes.
- Workspace and job data are currently held in the API service memory as a functional first-build seam for persistent storage.
- Long-form generation features are represented in the shared job model so they can later attach to streamed, resumable workers without replacing the UI.

## Product

The app provides a focused workspace for corpus inspection, document creation, provider-aware generation jobs, intelligence scoring, recent activity, job history, and provider/evaluation settings.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
