# NEUROTEXT environment variables

Set runtime values in Coolify's environment settings, not in source control or
Docker build arguments. No Replit account, private package registry, or
OpenRouter credential is needed.

## Required for production startup

| Variable | Expected value |
| --- | --- |
| `DATABASE_URL` | A reachable PostgreSQL URL: `postgresql://USER:PASSWORD@DATABASE_HOST:5432/neurotext`. Use the database's internal hostname on the Coolify network, not `localhost`. Add `?sslmode=verify-full` if the database requires TLS and has a trusted certificate. Existing PostgreSQL data is not replaced. |
| `SESSION_SECRET` | A stable, randomly generated secret containing at least 32 characters, used to sign account-session and anonymous OCR cookies. Keep unchanged across deployments and replicas. Generate locally with `openssl rand -hex 32`; never commit the result. |
| `PUBLIC_BASE_URL` | Your public HTTPS origin, for example `https://research.example.com`, with no path/query/fragment. Traefik must route that hostname to port 5000. |

The normal production start command initializes missing application tables using
non-destructive `CREATE TABLE IF NOT EXISTS` statements. The database user needs
permission to create those tables in its default schema on the first start.
Existing rows are preserved. Schema initialization failure stops startup with an
error; it is not silently ignored.

## Optional runtime settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Docker sets `production` | Production enables static frontend serving and secure signed cookies. Generation does not require login or impose an anonymous operation allowance. Use `development` locally with Vite. |
| `PORT` | `5000` | HTTP listening port on `0.0.0.0`. Match Coolify's exposed port if changed. |
| `LOG_LEVEL` | `info` | Pino log level: `debug`, `info`, `warn`, or `error`. Production logs are JSON. |
| `OPENAI_API_KEY` | unset | Enables direct OpenAI generation. |
| `ANTHROPIC_API_KEY` | unset | Enables direct Anthropic generation. |
| `PERPLEXITY_API_KEY` | unset | Enables direct Perplexity Sonar Pro, the default provider including long-text generation. |
| `XAI_API_KEY` | unset | Enables direct xAI/Grok generation. |
| `DEEPSEEK_API_KEY` | unset | Enables direct DeepSeek generation. |
| `VENICE_API_KEY` | unset | Enables direct Venice generation. |
| `OPENAI_MODEL` | `gpt-5` | An official model ID available to your OpenAI account. |
| `OCR_VISION_MODEL` | `OPENAI_MODEL`, otherwise `gpt-5` | A direct OpenAI model supporting image inputs and JSON-schema responses, used only for Function 11's specialist-script image transcription. |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` | An official model ID available to your Anthropic account. |
| `XAI_MODEL` | `grok-4` | An official model ID available to your xAI account. |
| `DEEPSEEK_MODEL` | `deepseek-chat` | An official model ID available to your DeepSeek account. |

All provider keys are optional **for startup**. Selecting an unconfigured provider
returns a visible error naming the missing key. There is no silent provider
substitution. At least one key is needed for actual AI generation.

`DATABASE_URL` is also required in development and for database management tools.
`SESSION_SECRET` and `PUBLIC_BASE_URL` are required only in production.

## Optional direct Google OAuth

| Variable | Required to start? | Expected value |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | No | A Google OAuth 2.0 **Web application** client ID. Enables optional Google sign-in together with the secret and public origin. |
| `GOOGLE_CLIENT_SECRET` | No | The matching Google OAuth client secret. Server-only; never a frontend build variable. |

Register `PUBLIC_BASE_URL` followed by `/api/auth/google/callback` as an exact
authorized redirect URI in the Google Cloud OAuth client's settings. For example,
`https://research.example.com/api/auth/google/callback`. Register a separate
callback for the workspace preview if testing there, and set development
`PUBLIC_BASE_URL` to that preview's HTTPS origin. Do not use a production origin
for a development login: its cookie belongs to a different host.

Google login is optional for public previews and has no charge of its own.
Production complete answers require both Google login and payment, with the
development and designated-owner exceptions described below.
Guests' workspace content is not stored in PostgreSQL and is not restored on
reload. Signed-in workspaces, output history and libraries are owner-scoped.
OAuth uses state, nonce, PKCE, verified Google identity tokens and regenerated
PostgreSQL-backed sessions. Tokens are not stored. Existing anonymous workspaces
are preserved in the database but are not automatically attached to new accounts.

## Relevance assessment

Function 12 (Relevance Assessment) uses the selected existing LLM provider and
needs no new credentials. Its default is Perplexity Sonar Pro
(`PERPLEXITY_API_KEY`). Files in either document box use the same Word extraction
and Mathpix image/PDF readers as other functions. Both documents are limited to
20,000 words / 120,000 characters per box; select chapters or excerpts for longer
work. Provider-generated quotations are checked against the submitted texts.

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

Function 11 (OCR) uses Mathpix by default for screenshots, handwriting, formulas
and PDFs. Its explicitly selected specialist-script mode sends image inputs to
direct OpenAI vision using `OPENAI_API_KEY`; it does not silently substitute one
provider for another. Specialist mode accepts images, not PDFs. Transcriptions
are editable, retain LaTeX and Unicode, and may be copied, downloaded, used in
functions 1–10, or stored as extracted text in the owner's private library.
Uncertain signs must be marked and checked manually. Specialist OCR is not
guaranteed decipherment or translation of hieroglyphs or other historical scripts.

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

Google account sessions use `express-session` with the external PostgreSQL
session store, `proxy: true`, and Secure/HttpOnly/SameSite=Lax production cookies.
The Google callback saves the regenerated session before redirecting. Private
writes require an app-specific request header for CSRF protection. Stripe keys
are optional at startup but required to accept payments. Google callback errors
are logged on the server; the browser receives a generic error without tokens.
Anonymous OCR cookies do not identify a signed-in account.

## Private library limits

Each account has 10,000 weighted pages and 50 MiB of weighted storage, whichever
is reached first. A page is 500 words, rounded up per document. TXT/Markdown
counts 1×; DOC/DOCX 2×; PDF/images 4×. Weighted bytes are the larger of the
extracted UTF-8 text size or original upload size, multiplied by that factor.
Thus the page ceiling is approximately 10,000 TXT, 5,000 DOC or 2,500 PDF pages,
subject to the byte allowance. Quotas are enforced in PostgreSQL transactions.

The library stores extracted text and metadata only, not original binary files.
The server extracts DOC/DOCX locally; Mathpix handles PDFs and images. Each file
is limited to 10 MiB. Supporting-material fields accept at most 20,000 words AND
120,000 characters per generation (approximately 40 pages of ordinary prose).
These are conservative app input limits, not a guarantee of model capacity for
every combination of draft, references and output. Longer sources must be
excerpted; the app rejects over-limit input rather than silently truncating it.

## Complete-answer access and Stripe (Coolify-compatible)

The public production app provides partial previews. Complete answers require a
verified Google session and a server-confirmed paid account, except for the
designated owner. Short answers show half; long answers show at most 5%, capped
at 500 words. This is enforced before sending generation output, not with CSS.

| Variable | Required to start? | Expected value |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | No | Stripe secret API key for the account owning the configured price. Required to accept payments. |
| `STRIPE_PRICE_ID` | No | Existing active positive fixed Stripe price. Recurring prices use subscription Checkout; one-time prices use payment Checkout. |
| `STRIPE_WEBHOOK_SECRET` | No | Signing secret for `https://neurotext.uk/api/stripe/webhook`. Required to verify payment lifecycle events. |
| `OWNER_EMAIL` | No | Optional additional Google-verified owner email. The explicitly designated owner remains recognized without this override. |

`STRIPE_PUBLISHABLE_KEY` is not needed or read by the hosted Checkout flow: the
server creates Checkout Sessions and the browser navigates to Stripe. No API key
is sent to the browser. Missing Stripe configuration disables checkout but never
grants unpaid full access or prevents the server from starting.

Keep `NODE_ENV=production` on Coolify. Only an actual `NODE_ENV=development`
server supplies automatic development-owner access, including a persistent
development library/workspace identity. Development never requires Google
login or payment and has no sign-out control. Development-owner identity is
never written into a browser authentication session. Production verifies the
Google account before applying the owner exemption; changing a hostname,
header, URL parameter or typed email cannot activate it.

Stripe success/cancel URLs use `PUBLIC_BASE_URL`. Success URLs alone do not grant
access. Subscription access requires an active subscription for the configured
price, a paid invoice and settled, non-refunded/non-disputed payment. Expired,
failed or cancelled access is removed. Cancelling at period end retains access
only through the paid period. Duplicate Checkout clicks reuse an open session.

Enable these webhook events on the endpoint corresponding to the signing secret:
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`invoice.paid`, `invoice.payment_failed`, `charge.refunded`,
`charge.dispute.created`, `charge.dispute.closed`, `refund.updated`.
Enable subscription cancellation in the Stripe customer portal. The frontend
shows the configured amount/currency and renewal interval before checkout and
provides Manage billing.

Billing uses the standard Stripe SDK and the external `DATABASE_URL`, not
Replit-managed credential discovery. The startup migration adds only the
application's account-to-Stripe/access mapping and does not replace the database
or create a duplicate product catalogue. Existing documents are preserved.

## Function 14: Relevance Finder

No additional provider keys are required. It uses the existing model selector
and defaults to Perplexity. `SESSION_SECRET` also signs report proofs so a
rewrite cannot use forged findings or a report for different inputs/accounts.
Rotating that secret requires generating a fresh report before rewriting.

The draft accepts up to 20,000 words / 120,000 characters. The relevant text
accepts up to 200,000 words / 1,200,000 characters (about 400 pages), scanned
in bounded sections and consolidated from quotation-verified findings.
File uploads remain limited to 10 MiB each. Custom instructions are optional
and limited to 10,000 characters. These larger source limits apply only to
Function 14, including its library picker and transfers; other functions retain
their existing limits. Nothing is silently truncated.

The report and optional rewritten draft are stored separately from the original
draft in existing private workspace/history storage. No database replacement
or destructive migration is required. Rewriting requires a complete, verified
report and existing full-answer access; development and designated production
owner exemptions are unchanged.
