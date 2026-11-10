# syntax=docker/dockerfile:1
# Official multi-architecture image: native linux/arm64 and linux/amd64 builds.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Upgrade npm first as requested; pnpm matches package.json's packageManager.
RUN npm install -g npm@11 && npm install -g pnpm@10.26.1
COPY . .
# Exactly one application dependency installation, including build dependencies.
RUN pnpm install --frozen-lockfile
RUN pnpm run build:production

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000 \
    PUPPETEER_SKIP_DOWNLOAD=true
# Server and migration dependencies are bundled. No install in this stage.
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=build --chown=node:node /app/artifacts/neurotext/dist/public ./artifacts/neurotext/dist/public
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
