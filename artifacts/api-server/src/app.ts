import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const production = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;
if (production) {
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters in production.");
  }
  if (!process.env.PUBLIC_BASE_URL) throw new Error("PUBLIC_BASE_URL is required in production.");
  const publicUrl = new URL(process.env.PUBLIC_BASE_URL);
  if (publicUrl.protocol !== "https:" || publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) {
    throw new Error("PUBLIC_BASE_URL must be the public HTTPS origin in production.");
  }
}

// Coolify's Traefik terminates HTTPS at one trusted proxy hop.
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors(production ? { origin: new URL(process.env.PUBLIC_BASE_URL!).origin, credentials: true } : {}));
// Dissertation drafts exceed Express's default 100 KB JSON body limit.
// Allow the draft plus instructions, references and JSON escaping overhead.
app.use(express.json({ limit: "32mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(sessionSecret));
app.use("/api", (req, res, next) => {
  if (req.path === "/healthz") { next(); return; }
  // Production uses signed cookies; never trust a modified or unsigned session ID.
  const existing = req.signedCookies?.neurotext_session ||
    (!production ? req.cookies?.neurotext_session : undefined);
  const sid = typeof existing === "string" && existing.length > 10 ? existing : randomUUID();
  req.cookies.neurotext_session = sid;
  if (!existing) {
    res.cookie("neurotext_session", sid, {
      signed: Boolean(sessionSecret),
      httpOnly: true,
      secure: production,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
  }
  next();
});

app.use("/api", router);
app.use("/api", (_req, res) => { res.status(404).json({ error: "API route not found" }); });

// One production HTTP server serves both the SPA and /api behind Traefik.
// Development keeps Vite separate as before.
if (production) {
  const publicDir = fileURLToPath(new URL("../../neurotext/dist/public/", import.meta.url));
  const indexFile = path.join(publicDir, "index.html");
  if (!existsSync(indexFile)) throw new Error("Frontend build missing. Run pnpm run build:production first.");
  app.use(express.static(publicDir, { index: false }));
  app.get("/{*splat}", (req, res, next) => {
    if (path.extname(req.path)) { next(); return; }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexFile);
  });
}

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log.error({ err }, "Request failed");
  if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
});

export default app;
