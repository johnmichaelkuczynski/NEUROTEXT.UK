import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { rm } from "node:fs/promises";

// A production-mode HTTP roundtrip against the real PostgreSQL store.
// Only the upstream Google token exchange/identity verification is mocked;
// no test authentication path is added to the application.
const root = fileURLToPath(new URL("../", import.meta.url));
const apiDir = path.join(root, "artifacts/api-server");
const { build } = createRequire(path.join(apiDir, "package.json"))("esbuild");
const dbRequire = createRequire(path.join(root, "lib/db/package.json"));
const { Pool } = dbRequire("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const subject = `google-proxy-test-${randomUUID()}`;
const entry = path.join(apiDir, "dist", `google-proxy-test-${randomUUID()}.mjs`);
const sessions = new Set();
let child;
let output = "";
try {
  await build({
    stdin: { resolveDir: apiDir, sourcefile: "google-proxy-test-entry.ts", contents: `
      import { createHash } from "node:crypto";
      import { OAuth2Client } from "google-auth-library";
      OAuth2Client.prototype.getToken = async function(options) {
        if (options.redirect_uri !== "https://neurotext.uk/api/auth/google/callback") throw new Error("Wrong token-exchange callback");
        const payload = JSON.parse(Buffer.from(options.code, "base64url").toString("utf8"));
        if (createHash("sha256").update(options.codeVerifier).digest("base64url") !== payload.challenge) throw new Error("Wrong PKCE verifier");
        return { tokens: { id_token: JSON.stringify({sub:process.env.GOOGLE_PROXY_TEST_SUB, email:"proxy-test@example.invalid", email_verified:true, nonce:payload.nonce}) } };
      };
      OAuth2Client.prototype.verifyIdToken = async function(options) {
        return { getPayload: () => JSON.parse(options.idToken) };
      };
      const {default:app} = await import("./src/app.ts");
      const server = app.listen(0, "127.0.0.1", () => console.log("PROXY_TEST_PORT="+server.address().port));
      process.on("SIGTERM", () => server.close(() => process.exit(0)));
    ` },
    outfile: entry, bundle: true, format: "esm", platform: "node",
    external: ["google-auth-library", "pg-native"],
    banner: { js: `import { createRequire as __testCreateRequire } from "node:module"; const require = __testCreateRequire(import.meta.url);` },
    logLevel: "silent",
  });
  child = spawn(process.execPath, [entry], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env, NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://neurotext.uk", SESSION_SECRET: randomBytes(48).toString("hex"),
      GOOGLE_CLIENT_ID: "proxy-test.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "proxy-test-only-secret", GOOGLE_PROXY_TEST_SUB: subject,
    },
  });
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  let port;
  for (let i = 0; i < 120; i++) {
    port = output.match(/PROXY_TEST_PORT=(\d+)/)?.[1];
    if (port) break;
    assert(child.exitCode === null, "Production OAuth test server exited before listening");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(port, "Production OAuth test server did not listen");
  const base = `http://127.0.0.1:${port}`;
  const request = (route, cookie, host = "neurotext.uk") => fetch(base + route, {
    redirect: "manual", headers: {
      Host: host, "X-Forwarded-Host": host, "X-Forwarded-Proto": "https",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const accountCookie = response => {
    const full = response.headers.getSetCookie().find(c => c.startsWith("neurotext_account="));
    if (!full) return undefined;
    assert(/;\s*Secure/i.test(full), "Production account cookie must be Secure behind TLS termination");
    assert(/;\s*HttpOnly/i.test(full), "Account cookie must be HttpOnly");
    assert(/;\s*SameSite=Lax/i.test(full), "Account cookie must allow Google's top-level callback");
    const cookie = full.split(";")[0];
    sessions.add(decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)).slice(2).split(".")[0]);
    return cookie;
  };
  const start = async () => {
    const response = await request("/api/auth/google");
    assert.equal(response.status, 302);
    const url = new URL(response.headers.get("location"));
    assert.equal(url.hostname, "accounts.google.com");
    assert.equal(url.searchParams.get("redirect_uri"), "https://neurotext.uk/api/auth/google/callback");
    const cookie = accountCookie(response);
    assert(cookie, "Google authorization must persist its session before redirect");
    const sid = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)).slice(2).split(".")[0];
    const stored = await pool.query("SELECT sess FROM neurotext_sessions WHERE sid=$1", [sid]);
    assert(stored.rows[0]?.sess.googleLogin?.nonce === url.searchParams.get("nonce"), "OAuth nonce must survive in PostgreSQL");
    return { cookie, state: url.searchParams.get("state"), nonce: url.searchParams.get("nonce"), challenge: url.searchParams.get("code_challenge") };
  };
  const alias = await request("/api/auth/google", undefined, "www.neurotext.uk");
  assert.equal(alias.status, 302);
  assert.equal(alias.headers.get("location"), "https://neurotext.uk/api/auth/google");
  assert(!accountCookie(alias), "Canonicalize www before creating the host-only account cookie");
  const wrongHost = await request("/api/auth/google", undefined, "neurotext.xyz");
  assert.equal(wrongHost.status, 503, "A mismatched public origin must fail explicitly, not lose OAuth state on another domain");
  const login = await start();
  const code = Buffer.from(JSON.stringify(login)).toString("base64url");
  const response = await request(`/api/auth/google/callback?state=${encodeURIComponent(login.state)}&code=${encodeURIComponent(code)}`, login.cookie);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://neurotext.uk/");
  const authenticated = accountCookie(response);
  assert(authenticated && authenticated !== login.cookie, "Successful login must regenerate its session");
  const me = await request("/api/auth/me", authenticated);
  assert.equal(me.status, 200);
  assert((await me.json()).user?.email === "proxy-test@example.invalid", "Saved login must be readable on the next proxied request");
  const badNonce = await start();
  const badCode = Buffer.from(JSON.stringify({...badNonce, nonce:"wrong-test-nonce"})).toString("base64url");
  const rejected = await request(`/api/auth/google/callback?state=${encodeURIComponent(badNonce.state)}&code=${encodeURIComponent(badCode)}`, badNonce.cookie);
  assert.equal(rejected.status, 302);
  assert.equal(rejected.headers.get("location"), "https://neurotext.uk/?authError=google_login_failed");
  for (let i = 0; i < 20 && !output.includes("Google authentication callback failed"); i++) await new Promise(resolve=>setTimeout(resolve,25));
  assert(output.includes("Google authentication callback failed") && output.includes('"stack"') && output.includes("Google identity or nonce verification failed"), "Callback failures must log the actual message and stack");
  console.log("PASS: production proxy trust, secure Lax HttpOnly cookies, PostgreSQL OAuth state and regenerated sessions, canonical callback, PKCE/nonce checks, alias handling, origin-mismatch detection and full callback error logging. Google token exchange was mocked.");
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve=>child.once("exit",resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await pool.query("DELETE FROM neurotext_sessions WHERE sid=ANY($1::varchar[]) OR sess->>'userId' IN (SELECT id FROM neurotext_users WHERE google_sub=$2)", [[...sessions], subject]);
  await pool.query("DELETE FROM neurotext_users WHERE google_sub=$1", [subject]);
  await pool.end();
  await rm(entry, { force: true });
}
