import { randomBytes } from "node:crypto";
import type { Request, RequestHandler } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";

export const DEVELOPMENT_OWNER_ID = "neurotext-development-owner";
export const developmentOwnerMode = () => process.env.NODE_ENV === "development";
let developmentOwnerReady: Promise<unknown> | undefined;
export const developmentOwnerAccount: RequestHandler = async (_req, _res, next) => {
  if (!developmentOwnerMode()) { next(); return; }
  try {
    // Never write an owner ID into a browser session: a development cookie
    // copied to production must remain anonymous there.
    await (developmentOwnerReady ??= pool.query(
      `INSERT INTO neurotext_users(id,google_sub,email,name) VALUES($1,$1,$2,'Development owner')
       ON CONFLICT(id) DO NOTHING`,
      [DEVELOPMENT_OWNER_ID, process.env.OWNER_EMAIL || "development-owner@localhost"]));
    next();
  } catch (error) { developmentOwnerReady = undefined; next(error); }
};
declare module "express-session" {
  interface SessionData {
    userId?: string;
    googleLogin?: { state: string; nonce: string; verifier: string; expires: number };
    paymentDraft?: { functionId: number; workspace: unknown };
  }
}
const PgSession = connectPgSimple(session);
export const accountSession = session({
  name: "neurotext_account",
  secret: process.env.SESSION_SECRET || randomBytes(48).toString("hex"),
  store: new PgSession({ pool, tableName: "neurotext_sessions", createTableIfMissing: false }),
  resave: false,
  saveUninitialized: false,
  proxy: true,
  rolling: true,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000 },
});
export const userId = (req: Request) => developmentOwnerMode() ? DEVELOPMENT_OWNER_ID : req.session?.userId;
export const privateAccount: RequestHandler = (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (!userId(req)) { res.status(401).json({ error: "Sign in with Google to access your private saved work and library. Generation is available without login." }); return; }
  next();
};
// Custom headers cannot be submitted by cross-site forms. CORS does not allow
// credentialed cross-origin requests outside our configured origin.
export const privateWrite: RequestHandler = (req, res, next) => {
  if (req.get("X-Neurotext-Request") !== "1" || req.get("Sec-Fetch-Site") === "cross-site") {
    res.status(403).json({ error: "Use the app to make this change." }); return;
  }
  next();
};
