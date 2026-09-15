# NEUROTEXT

NEUROTEXT is a persistent, streaming document-intelligence platform with ten specialized long-form writing and analysis functions.

## Run & Operate

- `pnpm --filter @workspace/neurotext run dev` — run the React/Vite web artifact
- `pnpm --filter @workspace/api-server run dev` — run the Express API server on `PORT`
- `pnpm run typecheck` — typecheck all workspace packages
- `pnpm run build` — typecheck and build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate typed API hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — apply development database schema changes

## Stack

- pnpm workspace, Node.js, and TypeScript
- React and Vite frontend in `artifacts/neurotext`
- Express API in `artifacts/api-server`
- PostgreSQL and Drizzle ORM in `lib/db`
- OpenAPI contract in `lib/api-spec/openapi.yaml`
- Generated React Query hooks and Zod schemas
- Server-side OpenAI, Anthropic, OpenRouter, and Venice AI clients

## Architecture

- The browser consumes generation streams directly with `fetch`, `ReadableStream`, and SSE frame parsing.
- All provider streams are normalized through the same NEUROTEXT SSE event protocol.
- Each of the ten functions has an independently persisted workspace.
- ZHI model labels are stable product-facing aliases; provider model identifiers remain server-side.
- Perplexity Sonar Pro, Grok, and DeepSeek use Replit-managed OpenRouter access. OpenAI and Anthropic use their Replit-managed integrations. Venice AI uses `VENICE_API_KEY`.

## Product

- Functions 01–10 retain independent instructions, sources, output, progress, and model choices.
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