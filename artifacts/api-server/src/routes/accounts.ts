import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { db, neurotextUsers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GetAccountResponse } from "@workspace/api-zod";
import { privateWrite, userId } from "../services/account-session";
import { MAX_LIBRARY_PAGES, MAX_LIBRARY_BYTES, MAX_REFERENCE_WORDS, MAX_REFERENCE_CHARACTERS } from "../services/library-limits";

const router: IRouter = Router();
const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";
const configured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.PUBLIC_BASE_URL);
function origin() {
  const url = new URL(process.env.PUBLIC_BASE_URL!);
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.hostname === "localhost")) throw new Error("PUBLIC_BASE_URL must be an HTTPS origin.");
  return url.origin;
}
function callbackUrl() {
  // The proxy's internal host/protocol must never determine the OAuth redirect.
  return `${origin()}${GOOGLE_CALLBACK_PATH}`;
}
function google(callbackURL: string) {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, callbackURL);
}
const matches = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

router.get("/auth/me", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const id = userId(req);
  const [user] = id ? await db.select({ id: neurotextUsers.id, name: neurotextUsers.name, email: neurotextUsers.email }).from(neurotextUsers).where(eq(neurotextUsers.id, id)).limit(1) : [];
  res.json(GetAccountResponse.parse({
    user: user || null, googleConfigured: configured(), maxReferenceWords: MAX_REFERENCE_WORDS,
    maxReferenceCharacters: MAX_REFERENCE_CHARACTERS, maxLibraryPages: MAX_LIBRARY_PAGES, maxLibraryBytes: MAX_LIBRARY_BYTES,
  }));
});
router.get("/auth/google", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (!configured()) { res.status(503).send("Google login is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and PUBLIC_BASE_URL. You can still use generation without login."); return; }
  try {
    const publicOrigin = origin();
    const publicHost = new URL(publicOrigin).hostname.toLowerCase();
    const requestHost = req.hostname.toLowerCase();
    // Host is checked only for cookie scope, never used to construct a callback.
    // A host-only session cookie cannot accompany Google's return to another site.
    if (requestHost !== publicHost) {
      if (requestHost === `www.${publicHost}` || publicHost === `www.${requestHost}`) {
        res.redirect(`${publicOrigin}/api/auth/google`);
        return;
      }
      req.log.error({ publicOrigin, requestHost, callbackURL: callbackUrl() }, "Google OAuth PUBLIC_BASE_URL does not match the sign-in site");
      res.status(503).send("Google sign-in is misconfigured: PUBLIC_BASE_URL does not match this website. Set it to this site's public HTTPS origin in Coolify and redeploy. Generation is still available without login.");
      return;
    }
    const callbackURL = callbackUrl();
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    req.session.googleLogin = { state, nonce, verifier, expires: Date.now() + 10 * 60 * 1000 };
    await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    res.redirect(google(callbackURL).generateAuthUrl({
      scope: ["openid", "email", "profile"], state, nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: CodeChallengeMethod.S256,
      prompt: "select_account",
    }));
  } catch (err) {
    req.log.error({ err }, "Google authorization could not start");
    res.status(503).send("Google login could not start. Generation is still available without login.");
  }
});
router.get("/auth/google/callback", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const pending = req.session.googleLogin;
    delete req.session.googleLogin;
    // Persist consumption before exchanging a code, preventing callback replay.
    await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    if (!pending || pending.expires < Date.now() || typeof req.query.state !== "string" || !matches(req.query.state, pending.state)) throw new Error("Google OAuth state was missing, expired or invalid.");
    if (req.query.error || typeof req.query.code !== "string") throw new Error(`Google authorization declined or missing code: ${String(req.query.error || "no_code")}`);
    const callbackURL = callbackUrl();
    const client = google(callbackURL);
    const { tokens } = await client.getToken({ code: req.query.code, codeVerifier: pending.verifier, redirect_uri: callbackURL });
    if (!tokens.id_token) throw new Error("Google did not return an identity token.");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const identity = ticket.getPayload();
    const nonce = (identity as typeof identity & { nonce?: string })?.nonce;
    if (!identity?.sub || !identity.email || !identity.email_verified || !nonce || !matches(nonce, pending.nonce)) throw new Error("Google identity or nonce verification failed.");
    const [account] = await db.insert(neurotextUsers).values({
      id: randomUUID(), googleSub: identity.sub, email: identity.email, name: identity.name || identity.email,
    }).onConflictDoUpdate({ target: neurotextUsers.googleSub, set: { email: identity.email, name: identity.name || identity.email } }).returning({ id: neurotextUsers.id });
    await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = account.id;
    await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    res.redirect(`${origin()}/`);
  } catch (err) {
    // Log the actual error, not authorization codes or provider tokens.
    req.log.error({ err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err) }, "Google authentication callback failed");
    res.redirect(`${process.env.PUBLIC_BASE_URL ? origin() : ""}/?authError=google_login_failed`);
  }
});
router.post("/auth/logout", privateWrite, async (req, res): Promise<void> => {
  await new Promise<void>((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
  res.clearCookie("neurotext_account", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true });
});
export default router;
