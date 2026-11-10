# Deploy NEUROTEXT on Coolify

1. Connect the Git repository and choose branch `main`.
2. Choose the **Dockerfile** build pack, root context `/`, Dockerfile `/Dockerfile`.
   The Node 22 Debian image supports `linux/arm64` and `linux/amd64` natively.
   The build stage runs natively on the builder; the final image uses the target
   architecture. Only bundled JavaScript and static files cross stages. There are
   no x64-only dependency exclusions.
3. Attach a PostgreSQL database with persistent storage on the same private network.
   If moving existing data, back up and restore that database separately; deploying
   code does not copy the current database or uploaded files.
4. Set the three required runtime values in `ENV_VARS.md`: `DATABASE_URL`,
   `SESSION_SECRET` and `PUBLIC_BASE_URL`. Add your own provider API keys as needed,
   especially `PERPLEXITY_API_KEY` for the default model. Do not put secrets into
   Docker build arguments. Old `AI_INTEGRATIONS_*` variables are not used.
5. Set Coolify's container port to **5000**, domain to the same HTTPS origin as
   `PUBLIC_BASE_URL`, and health path to **`/api/healthz`**. Use normal Traefik TLS
   termination and forwarding headers. Do not enable response buffering or
   compression on `/api/functions/stream` or `/api/coherence/stream`. Do not apply
   a short proxy request timeout to those routes; generation may last many minutes.
6. Deploy. `npm start` initializes missing tables without dropping existing data,
   then starts one HTTP server serving both the built frontend and `/api`.
   The image runs as the unprivileged `node` user.

No persistent application volume is needed for the current text workflows: workspace
content, usage and visitor counts are in PostgreSQL. Keep PostgreSQL storage backed
up. Marketing video exports are not app runtime dependencies and are not in the
image.

## Local production check

Use Node 22.14+ and pnpm 10.26.1. Install once using `pnpm install --frozen-lockfile`,
then run `pnpm run build:production`. Set the required environment variables and run
`NODE_ENV=production npm start`. Open `http://localhost:5000` for a basic local
check; production cookies require HTTPS through Traefik in real use.

`pnpm run test:production` starts an isolated production server on port 5000 with all
optional provider keys removed. It checks health, static files, SPA routes, signed
cookies, database workspace reads and explicit missing-provider errors. It requires
a reachable `DATABASE_URL`; it does not perform paid generation. Its subprocess
initializes missing tables just like production; it does not delete application data.

For a Docker-capable machine:

```sh
docker build --platform linux/arm64 -t neurotext .
docker run --rm --env-file /secure/path/neurotext.env -p 5000:5000 neurotext
```

Do not commit the environment file. An ARM64 image requires an ARM64 host (or
appropriate emulation) to run; it can be built on an AMD64 builder without
emulation because the runtime stage does not execute build commands.

## Current product limits, not deployment failures

The production anonymous allowance remains three successful operations. Actual
user sign-in, owner authorization and subscription billing are not implemented.
This deployment work does not add or imply those features.

## Verification performed

- A clean source copy passed `pnpm install --frozen-lockfile`, type checks, and
  `pnpm run build:production`, without cached build outputs or declarations.
- `pnpm run test:production` passed with all optional AI keys removed and with
  `PORT` unset, exercising the default port 5000.
- The bundled runtime passed the same checks without any `node_modules` directory.
- The Dockerfile successfully built a `linux/arm64` image; its image architecture
  was inspected and confirmed as ARM64.
- An AMD64 image built from the same Dockerfile started successfully as the
  unprivileged production user, initialized PostgreSQL, served the frontend and
  ten workspaces, and returned secure cookies. Native ARM64 execution and the
  actual Coolify/Traefik deployment have not been exercised in this workspace.
- The application has no runtime imports of files in `attached_assets`, no
  Replit Vite plugins or managed AI clients, and no private registry URLs in its
  lockfile or npm configuration.
