import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const env = {
  ...process.env,
  NODE_ENV: "production",
  PUBLIC_BASE_URL: "https://localhost",
  SESSION_SECRET: randomBytes(32).toString("hex"),
};
delete env.PORT; // Exercise the production default of port 5000.
for (const key of Object.keys(env)) {
  if (key.endsWith("_API_KEY") || key.startsWith("AI_INTEGRATIONS_") || key.startsWith("REPLIT_")) {
    delete env[key];
  }
}
assert(env.DATABASE_URL, "DATABASE_URL is required for the production smoke check");
const base = "http://127.0.0.1:5000";
// Do not accidentally verify or stop an already-running server.
const occupied = await fetch(`${base}/api/healthz`).then(() => true, () => false);
assert(!occupied, "Port 5000 is already occupied; production smoke check will not disturb it");

const child = spawn("npm", ["start"], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let output = "";
child.stdout.on("data", chunk => { output += chunk; });
child.stderr.on("data", chunk => { output += chunk; });
const stop = () => {
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already stopped */ }
};
process.on("exit", stop);
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) break;
    ready = await fetch(`${base}/api/healthz`).then(r => r.ok, () => false);
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(ready, "Production server did not become healthy");
  const homepage = await fetch(base);
  assert.equal(homepage.status, 200);
  const html = await homepage.text();
  assert(html.includes("<title>NEUROTEXT</title>"));
  const asset = html.match(/src="([^"]+\.js)"/)?.[1];
  assert(asset, "Built frontend script was not found");
  assert.equal((await fetch(new URL(asset, base))).status, 200);
  assert.equal((await fetch(`${base}/diagnostics`)).status, 200);
  assert.equal((await fetch(`${base}/api/not-a-route`)).status, 404);
  assert.equal((await fetch(`${base}/assets/not-a-file.js`)).status, 404);

  const workspace = await fetch(`${base}/api/functions/workspaces`, {
    headers: { "X-Forwarded-Proto": "https" },
  });
  assert.equal(workspace.status, 200);
  const workspaces = await workspace.json();
  assert.equal(workspaces.length, 10);
  assert(workspaces.every(w => w.selectedModel.includes("Perplexity")));
  const cookie = workspace.headers.get("set-cookie");
  assert(cookie && /HttpOnly/i.test(cookie) && /Secure/i.test(cookie) && /SameSite=Lax/i.test(cookie));
  assert(cookie.includes("s%3A"), "Session cookie must be signed");
  const repeated = await fetch(`${base}/api/functions/workspaces`, {
    headers: { Cookie: cookie.split(";")[0], "X-Forwarded-Proto": "https" },
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.headers.get("set-cookie"), null, "Valid signed session must survive later requests");

  const invalidCookie = await fetch(`${base}/api/functions/workspaces`, {
    headers: { Cookie: "neurotext_session=forged-session-123", "X-Forwarded-Proto": "https" },
  });
  assert(invalidCookie.headers.get("set-cookie"), "Unsigned sessions must be replaced");

  const missingKey = await fetch(`${base}/api/functions/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie.split(";")[0] },
    body: JSON.stringify({
      functionId: 1,
      instructions: "Production connectivity check",
      sourceDocument: "",
      targetWords: 4000,
      selectedModel: "ZHI 1 · OpenAI GPT-5.6 Terra",
      thinker: "",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const events = await missingKey.text();
  assert(events.includes('"type":"error"') && events.includes("OPENAI_API_KEY"), "Missing optional key must return an explicit SSE error");
  assert(!events.includes('"type":"complete"'));
  console.log("PASS: production startup without optional keys; database initialization; frontend/SPA/assets; API 404; secure signed sessions; missing-provider SSE error.");
} catch (err) {
  // Never print connection strings or secrets from a failed subprocess.
  console.error("Production smoke check failed:", err.message);
  console.error("Server output retained only in this process; inspect local server logs without exposing credentials.");
  process.exitCode = 1;
} finally {
  stop();
  await new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    child.once("exit", resolve);
    setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} resolve(); }, 3000).unref();
  });
  process.removeListener("exit", stop);
}
