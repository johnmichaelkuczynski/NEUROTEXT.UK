import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify, type JsonWebKeyInput } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { hasActivePaidAccess } from "../services/stripe-direct";

type GoogleClaims = {
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  nonce?: string;
  exp?: number;
};

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  picture?: string;
};

const authRouter = Router();
const SESSION_COOKIE = "neurotext_session";
const OAUTH_COOKIE = "neurotext_oauth";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_SECONDS = 60 * 10;
const VISITOR_COOKIE = "neurotext_visitor";
const PERMANENT_OWNER_EMAIL = "johnmichaelkuczynski@gmail.com";
const GUEST_OPERATION_LIMIT = 3;
const USER_OPERATION_LIMIT = 20;
let usageTableReady: Promise<unknown> | null = null;

function requiredEnvironment(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "SESSION_SECRET") {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function signPayload(payload: object) {
  const encoded = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", requiredEnvironment("SESSION_SECRET")).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readSignedPayload<T>(value?: string): T | null {
  if (!value) return null;
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", requiredEnvironment("SESSION_SECRET")).update(encoded).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function isSecure(req: Request) {
  return req.secure || req.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

function cookie(name: string, value: string, req: Request, maxAge: number) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isSecure(req)) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(name: string, req: Request) {
  return cookie(name, "", req, 0);
}

function ensureUsageTable() {
  usageTableReady ??= pool.query(`
    CREATE TABLE IF NOT EXISTS neurotext_free_usage (
      principal_id TEXT PRIMARY KEY,
      used_tokens INTEGER NOT NULL DEFAULT 0,
      used_operations INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).then(() => pool.query("ALTER TABLE neurotext_free_usage ADD COLUMN IF NOT EXISTS used_operations INTEGER NOT NULL DEFAULT 0"));
  return usageTableReady;
}

function requestOrigin(req: Request) {
  const protocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) throw new Error("The public application origin is unavailable.");
  return `${protocol}://${host}`;
}

async function verifyGoogleIdToken(idToken: string, expectedNonce: string): Promise<GoogleClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Google returned an invalid identity token.");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { alg?: string; kid?: string };
  if (header.alg !== "RS256" || !header.kid) throw new Error("Google returned an unsupported identity token.");
  const keysResponse = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!keysResponse.ok) throw new Error("Google identity verification is temporarily unavailable.");
  const keys = await keysResponse.json() as { keys?: Array<JsonWebKeyInput["key"] & { kid?: string }> };
  const jwk = keys.keys?.find((candidate) => candidate.kid === header.kid);
  if (!jwk) throw new Error("Google identity verification key was not found.");
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  if (!verify("RSA-SHA256", signed, publicKey, Buffer.from(parts[2], "base64url"))) {
    throw new Error("Google identity signature verification failed.");
  }
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as GoogleClaims;
  const now = Math.floor(Date.now() / 1000);
  if (!["https://accounts.google.com", "accounts.google.com"].includes(claims.iss ?? "")) throw new Error("Google identity issuer is invalid.");
  if (claims.aud !== requiredEnvironment("GOOGLE_CLIENT_ID")) throw new Error("Google identity audience is invalid.");
  if (!claims.exp || claims.exp <= now) throw new Error("Google identity token has expired.");
  if (claims.nonce !== expectedNonce) throw new Error("Google identity nonce is invalid.");
  if (!claims.sub || !claims.email || claims.email_verified !== true) throw new Error("A verified Google email address is required.");
  return claims;
}

export function getAuthenticatedUser(req: Request): AuthUser | null {
  if (process.env.NODE_ENV !== "production") {
    return {
      id: "development-owner",
      email: "development@local.neurotext",
      name: "Development owner",
    };
  }
  const session = readSignedPayload<AuthUser & { exp?: number }>(req.cookies?.[SESSION_COOKIE]);
  if (!session?.id || !session.email || !session.exp || session.exp <= Math.floor(Date.now() / 1000)) return null;
  return { id: session.id, email: session.email, name: session.name || session.email, picture: session.picture };
}

export function hasPermanentOwnerAccess(user: AuthUser | null) {
  return Boolean(user && user.email.trim().toLowerCase() === PERMANENT_OWNER_EMAIL);
}

export function ensureVisitor(req: Request, res: Response, next: NextFunction) {
  const existing = readSignedPayload<{ id?: string; exp?: number }>(req.cookies?.[VISITOR_COOKIE]);
  if (existing?.id && existing.exp && existing.exp > Math.floor(Date.now() / 1000)) {
    res.locals.visitorId = existing.id;
    next();
    return;
  }
  const visitorId = randomBytes(24).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  res.locals.visitorId = visitorId;
  res.append("Set-Cookie", cookie(VISITOR_COOKIE, signPayload({ id: visitorId, exp }), req, SESSION_SECONDS));
  next();
}

function usageIdentity(req: Request, res: Response) {
  const user = getAuthenticatedUser(req);
  return user
    ? { principalId: `google:${user.id}`, authenticated: true, limit: USER_OPERATION_LIMIT }
    : { principalId: `guest:${String(res.locals.visitorId)}`, authenticated: false, limit: GUEST_OPERATION_LIMIT };
}

const meteredPaths = new Set(["/diagnostics/run", "/coherence/analyze", "/coherence/stream", "/functions/run", "/functions/stream"]);

export async function enforceFreeUsage(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV !== "production") {
    res.setHeader("X-Neurotext-Development-Access", "unlimited");
    next();
    return;
  }
  if (req.method !== "POST" || !meteredPaths.has(req.path)) {
    next();
    return;
  }
  try {
    const user = getAuthenticatedUser(req);
    if (hasPermanentOwnerAccess(user)) {
      res.setHeader("X-Neurotext-Owner-Access", "permanent-unlimited");
      next();
      return;
    }
    await ensureUsageTable();
    const identity = usageIdentity(req, res);
    if (user && await hasActivePaidAccess(user.email)) {
      res.setHeader("X-Neurotext-Paid-Access", "active");
      next();
      return;
    }
    const current = await pool.query<{ used_operations: number }>("SELECT used_operations FROM neurotext_free_usage WHERE principal_id = $1", [identity.principalId]);
    const used = Number(current.rows[0]?.used_operations ?? 0);
    if (used >= identity.limit) {
      res.status(402).json({
        code: identity.authenticated ? "PAYMENT_REQUIRED" : "LOGIN_REQUIRED",
        message: identity.authenticated
          ? "Your 20 signed-in operations have been used. Subscribe for $500 per month for full access to Treatise Pro, including ongoing maintenance and direct software support by email, phone, and Google Meet."
          : "Your three anonymous operations have been used. Sign in with Google for 20 additional operations.",
        usage: { authenticated: identity.authenticated, usedOperations: used, limitOperations: identity.limit, remainingOperations: 0 },
      });
      return;
    }
    const result = await pool.query<{ used_operations: number }>(`
      INSERT INTO neurotext_free_usage (principal_id, used_operations)
      VALUES ($1, 1)
      ON CONFLICT (principal_id) DO UPDATE
      SET used_operations = neurotext_free_usage.used_operations + 1, updated_at = NOW()
      RETURNING used_operations
    `, [identity.principalId]);
    const nextUsed = Number(result.rows[0]?.used_operations ?? used + 1);
    res.setHeader("X-Neurotext-Operations-Remaining", String(Math.max(0, identity.limit - nextUsed)));
    next();
  } catch (error) {
    req.log.error({ error }, "Free usage check failed");
    res.status(503).json({ error: "Usage allowance could not be checked. Please try again." });
  }
}

authRouter.get("/google", (req, res) => {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = `${requestOrigin(req)}/api/auth/google/callback`;
  const transaction = signPayload({ state, nonce, verifier, redirectUri, exp: Math.floor(Date.now() / 1000) + OAUTH_SECONDS });
  res.setHeader("Set-Cookie", cookie(OAUTH_COOKIE, transaction, req, OAUTH_SECONDS));
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.searchParams.set("client_id", requiredEnvironment("GOOGLE_CLIENT_ID"));
  authorization.searchParams.set("redirect_uri", redirectUri);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", "openid email profile");
  authorization.searchParams.set("state", state);
  authorization.searchParams.set("nonce", nonce);
  authorization.searchParams.set("code_challenge", challenge);
  authorization.searchParams.set("code_challenge_method", "S256");
  authorization.searchParams.set("prompt", "select_account");
  res.redirect(authorization.toString());
});

authRouter.get("/google/callback", async (req, res) => {
  try {
    const transaction = readSignedPayload<{ state: string; nonce: string; verifier: string; redirectUri: string; exp: number }>(req.cookies?.[OAUTH_COOKIE]);
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!transaction || transaction.exp <= Math.floor(Date.now() / 1000) || !state || state !== transaction.state || !code) {
      res.status(400).send("Google sign-in could not be verified. Return to NEUROTEXT and try again.");
      return;
    }
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: requiredEnvironment("GOOGLE_CLIENT_ID"),
        client_secret: requiredEnvironment("GOOGLE_CLIENT_SECRET"),
        code,
        code_verifier: transaction.verifier,
        grant_type: "authorization_code",
        redirect_uri: transaction.redirectUri,
      }),
    });
    const tokens = await tokenResponse.json() as { id_token?: string };
    if (!tokenResponse.ok || !tokens.id_token) throw new Error("Google did not complete the authorization exchange.");
    const claims = await verifyGoogleIdToken(tokens.id_token, transaction.nonce);
    const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    const session = signPayload({ id: claims.sub, email: claims.email, name: claims.name || claims.email, picture: claims.picture, exp: expires });
    res.setHeader("Set-Cookie", [
      cookie(SESSION_COOKIE, session, req, SESSION_SECONDS),
      clearCookie(OAUTH_COOKIE, req),
    ]);
    res.redirect(`${requestOrigin(req)}/`);
  } catch (error) {
    req.log.error({ error }, "Google OAuth callback failed");
    res.status(401).send("Google sign-in could not be completed. Return to NEUROTEXT and try again.");
  }
});

authRouter.get("/me", (req, res) => {
  const user = getAuthenticatedUser(req);
  res.json({ user });
});

authRouter.get("/usage", async (req, res) => {
  if (process.env.NODE_ENV !== "production") {
    res.json({ authenticated: Boolean(getAuthenticatedUser(req)), usedOperations: 0, limitOperations: 0, remainingOperations: 0, unlimited: true });
    return;
  }
  const user = getAuthenticatedUser(req);
  if (hasPermanentOwnerAccess(user)) {
    res.json({
      authenticated: true,
      usedOperations: 0,
      limitOperations: 0,
      remainingOperations: 0,
      unlimited: true,
      ownerAccess: true,
      accessTier: "highest",
    });
    return;
  }
  await ensureUsageTable();
  const identity = usageIdentity(req, res);
  const result = await pool.query<{ used_operations: number }>("SELECT used_operations FROM neurotext_free_usage WHERE principal_id = $1", [identity.principalId]);
  const usedOperations = Number(result.rows[0]?.used_operations ?? 0);
  res.json({ authenticated: identity.authenticated, usedOperations, limitOperations: identity.limit, remainingOperations: Math.max(0, identity.limit - usedOperations) });
});

authRouter.post("/logout", (req, res) => {
  res.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE, req));
  res.status(204).end();
});

export default authRouter;