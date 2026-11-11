# NEUROTEXT environment variables

Set runtime values in Coolify's environment settings, not in source control or
Docker build arguments. No Replit account, private package registry, or
OpenRouter credential is needed.

## Required for production startup

| Variable | Expected value |
| --- | --- |
| `DATABASE_URL` | A reachable PostgreSQL URL: `postgresql://USER:PASSWORD@DATABASE_HOST:5432/neurotext`. Use the database's internal hostname on the Coolify network, not `localhost`. Add `?sslmode=verify-full` if the database requires TLS and has a trusted certificate. Existing PostgreSQL data is not replaced. |
| `SESSION_SECRET` | A stable, randomly generated secret containing at least 32 characters, used to sign anonymous workspace cookies. Keep unchanged across deployments and replicas. Generate locally with `openssl rand -hex 32`; never commit the result. |
| `PUBLIC_BASE_URL` | Your public HTTPS origin, for example `https://research.example.com`, with no path/query/fragment. Traefik must route that hostname to port 5000. |

The normal production start command initializes missing application tables using
non-destructive `CREATE TABLE IF NOT EXISTS` statements. The database user needs
permission to create those tables in its default schema on the first start.
Existing rows are preserved. Schema initialization failure stops startup with an
error; it is not silently ignored.

## Optional runtime settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Docker sets `production` | Production enables static frontend serving, secure signed cookies and the existing anonymous usage limit. Use `development` locally with Vite. |
| `PORT` | `5000` | HTTP listening port on `0.0.0.0`. Match Coolify's exposed port if changed. |
| `LOG_LEVEL` | `info` | Pino log level: `debug`, `info`, `warn`, or `error`. Production logs are JSON. |
| `OPENAI_API_KEY` | unset | Enables direct OpenAI generation. |
| `ANTHROPIC_API_KEY` | unset | Enables direct Anthropic generation. |
| `PERPLEXITY_API_KEY` | unset | Enables direct Perplexity Sonar Pro, the default provider including long-text generation. |
| `XAI_API_KEY` | unset | Enables direct xAI/Grok generation. |
| `DEEPSEEK_API_KEY` | unset | Enables direct DeepSeek generation. |
| `VENICE_API_KEY` | unset | Enables direct Venice generation. |
| `OPENAI_MODEL` | `gpt-5` | An official model ID available to your OpenAI account. |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` | An official model ID available to your Anthropic account. |
| `XAI_MODEL` | `grok-4` | An official model ID available to your xAI account. |
| `DEEPSEEK_MODEL` | `deepseek-chat` | An official model ID available to your DeepSeek account. |

All provider keys are optional **for startup**. Selecting an unconfigured provider
returns a visible error naming the missing key. There is no silent provider
substitution. At least one key is needed for actual AI generation.

`DATABASE_URL` is also required in development and for database management tools.
`SESSION_SECRET` and `PUBLIC_BASE_URL` are required only in production.

## Optional Mathpix OCR credentials

| Variable | Required to start? | Expected value |
| --- | --- | --- |
| `MATHPIX_API_KEY` | No | Your Mathpix app key, sent as the server-side `app_key` header. Required only for image/PDF OCR. |
| `MATHPIX_API_ID` | No | Your Mathpix application ID, sent as `app_id`. This is the exact variable name the app reads. |

Equation display uses bundled KaTeX and needs no API key. Text/Markdown uploads
also work without Mathpix. Image/PDF uploads are sent to Mathpix only when a user
selects them; the interface discloses this. Files are processed in memory, not
stored as database blobs. PDF polling jobs are session-scoped and expire after
30 minutes; a server restart requires re-uploading an unfinished PDF. Configure
both credentials separately in Coolify; workspace Secrets do not transfer there.

## Build/development settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `BASE_PATH` | `/` | Vite public base path. Keep `/` for the single-server Coolify deployment; development preview tooling can supply its own prefix. |
| `PUPPETEER_SKIP_DOWNLOAD` | Docker sets `true` | Prevents browser downloads if Puppeteer is ever introduced. Puppeteer is not currently an application dependency. |

Vite's `import.meta.env.BASE_URL` and `DEV` are generated build constants, not
secrets or additional runtime settings. PostgreSQL's standard `PG*` variables can
affect its driver defaults; configure connection details explicitly in
`DATABASE_URL` instead.

## HTTPS proxy, cookies, and authentication

Express trusts one proxy hop before processing cookies and requests. Traefik must
overwrite/forward `X-Forwarded-Proto: https` and `X-Forwarded-For`. Production
workspace cookies are signed, `Secure`, `HttpOnly`, and `SameSite=Lax`.

There is no login/OAuth implementation or `express-session` middleware in this
repo. Stripe and Google OAuth keys are not read and are not required. No callback
URLs, post-login redirects, or `req.session.save()` calls exist to migrate.
If OAuth is added later, derive callbacks from `PUBLIC_BASE_URL`, configure session
middleware with `proxy: true`, save sessions before redirects, and log callback
errors on the server. Anonymous workspace cookies do not provide owner login.
