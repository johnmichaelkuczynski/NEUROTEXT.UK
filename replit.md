# NEUROTEXT

NEUROTEXT is a streaming document-intelligence platform with ten writing/analysis functions and an eleventh OCR resource function. Persistence and private libraries are optional, account-only features.

## Run & Operate

- `pnpm --filter @workspace/neurotext run dev` — run the React/Vite web artifact
- `pnpm --filter @workspace/api-server run dev` — run the Express API server on `PORT`
- `pnpm run typecheck` — typecheck all workspace packages
- `pnpm run build` — typecheck and build all packages
- `pnpm run build:production` — typecheck and build the production frontend and API
- `NODE_ENV=production npm start` — initialize missing PostgreSQL tables and serve frontend/API on port 5000
- `pnpm run test:production` — isolated production smoke check without optional provider keys
- `pnpm --filter @workspace/api-spec run codegen` — regenerate typed API hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — apply development database schema changes

## Stack

- pnpm workspace, Node.js, and TypeScript
- React and Vite frontend in `artifacts/neurotext`
- Express API in `artifacts/api-server`
- PostgreSQL and Drizzle ORM in `lib/db`
- OpenAPI contract in `lib/api-spec/openapi.yaml`
- Generated React Query hooks and Zod schemas
- Direct server-side OpenAI, Anthropic, Perplexity, xAI, DeepSeek and Venice AI clients; Mathpix for mathematical OCR

## Architecture

- The browser consumes generation streams directly with `fetch`, `ReadableStream`, and SSE frame parsing.
- All provider streams are normalized through the same NEUROTEXT SSE event protocol.
- Each of the eleven functions has an independent workspace. Signed-in work persists in external PostgreSQL; guest work is not restored after reload.
- ZHI model labels are stable product-facing aliases; provider model identifiers remain server-side.
- Generation uses each provider's official API directly, with no Replit AI proxy or OpenRouter dependency at runtime.
- Server credentials: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`; optional providers use `XAI_API_KEY`, `DEEPSEEK_API_KEY`, and `VENICE_API_KEY`. Missing keys fail explicitly only when that provider is selected.
- OpenAI defaults to `gpt-5` and Anthropic to `claude-sonnet-4-5`; override with `OPENAI_MODEL` and `ANTHROPIC_MODEL`. Grok and DeepSeek support `XAI_MODEL` and `DEEPSEEK_MODEL`.
- Coolify uses the root multi-stage Dockerfile; see `COOLIFY.md` and `ENV_VARS.md`. Production requires `DATABASE_URL`, a stable `SESSION_SECRET`, and the HTTPS origin `PUBLIC_BASE_URL`. The old `AI_INTEGRATIONS_*` variables are unused.
- Production serves the SPA and API on one HTTP listener behind one trusted Traefik proxy hop. Optional direct Google OAuth uses PostgreSQL-backed sessions and owner-scoped private data. Anonymous OCR cookies do not identify an account.

## Product

- Functions 01–10 retain independent instructions, sources, output, progress, and model choices.
- Function 11 converts screenshots, image files and PDFs to editable resource text. Mathpix is the default; explicit specialist-script image mode uses direct OpenAI vision (`OCR_VISION_MODEL`, otherwise `OPENAI_MODEL` or `gpt-5`). Never silently substitute providers or promise authoritative decipherment.
- OCR transcriptions can be copied, downloaded, used in functions 01–10, or explicitly saved to the signed-in user's private library. Original image bytes are not archived.
- Long-document generation can continue across multiple provider calls until the requested word target is reached.
- Generated documents can be interrupted, resumed, copied, downloaded, and transferred between functions.
- `/diagnostics` records provider, first-word latency, elapsed time, word count, status, and failure evidence.

## Important behavior

- Do not lower the function-specific minimum word targets.
- Perplexity Sonar Pro is the default LLM for new and untouched workspaces, including long-document generation.
- Function 01 defaults to the supplied scholarly 5,000-word instruction.
- Function 01 instructions and its uploaded or pasted source document are separate inputs and must never be merged into one editable field.
- A transfer must not clear the source workspace or discard unrelated destination work.
- Never expose provider keys in browser code, responses, logs, or chat.
- Do not silently substitute one provider when the selected provider fails; return explicit evidence.