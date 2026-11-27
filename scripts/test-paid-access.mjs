import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Stripe from "stripe";

// No real Stripe customers, checkout sessions, subscriptions or charges are
// created. Only provider SDKs are replaced in this isolated test build.
const root = fileURLToPath(new URL("../", import.meta.url));
const api = path.join(root, "artifacts/api-server");
const { build } = createRequire(path.join(api, "package.json"))("esbuild");
const { Pool } = createRequire(path.join(root, "lib/db/package.json"))("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ids = Array.from({ length: 3 }, () => `billing-test-${randomUUID()}`);
const [owner, unpaid, other] = ids;
const secret = randomBytes(48).toString("hex");
const entry = path.join(api, "dist", `billing-test-${randomUUID()}.mjs`);
const sessionIds = [];
let child, logs = "";
try {
  for (const [i, id] of ids.entries()) {
    await pool.query("INSERT INTO neurotext_users(id,google_sub,email,name) VALUES($1,$1,$2,'Billing fixture')",
      [id, i === 0 ? "johnmichaelkuczynski@gmail.com" : `${id}@example.invalid`]);
  }
  await pool.query("INSERT INTO neurotext_billing(user_id,stripe_customer_id) VALUES($1,'cus_billing_fixture')", [unpaid]);
  const cookie = async user => {
    const sid = randomBytes(24).toString("hex");
    sessionIds.push(sid);
    await pool.query("INSERT INTO neurotext_sessions(sid,sess,expire) VALUES($1,$2,now()+interval '1 hour')",
      [sid, JSON.stringify({ cookie: { originalMaxAge: 3600000, expires: new Date(Date.now() + 3600000).toISOString(), secure: true, httpOnly: true, sameSite: "lax" }, userId: user })]);
    const signature = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/u, "");
    return `neurotext_account=${encodeURIComponent(`s:${sid}.${signature}`)}`;
  };
  const ownerCookie = await cookie(owner), userCookie = await cookie(unpaid), otherCookie = await cookie(other);
  await build({
    stdin: { resolveDir: root, sourcefile: "billing-test-entry.ts", contents: `
      import {fixture} from "./scripts/fixtures/stripe-billing-mock.ts";
      const {default:app} = await import("./artifacts/api-server/src/app.ts");
      app.post("/__billing_fixture", (req,res) => { Object.assign(fixture,req.body);res.json(fixture); });
      const server=app.listen(0,"127.0.0.1",()=>console.log("BILLING_TEST_PORT="+server.address().port));
      app.post("/__billing_fixture_stop",(_req,res)=>{res.json({ok:true});setTimeout(()=>server.close(()=>process.exit(0)),30);});
      process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
    ` },
    outfile: entry, bundle: true, format: "esm", platform: "node", external: ["pg-native"],
    alias: { stripe: path.join(root, "scripts/fixtures/stripe-billing-mock.ts"), openai: path.join(root, "scripts/fixtures/openai-billing-mock.ts") },
    banner: { js: 'import {createRequire as __cr} from "node:module";const require=__cr(import.meta.url);' },
    logLevel: "silent",
  });
  child = spawn(process.execPath, [entry], { cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, OWNER_EMAIL: "", NODE_ENV: "production", PUBLIC_BASE_URL: "https://neurotext.uk",
      SESSION_SECRET: secret, STRIPE_SECRET_KEY: "sk_test_fixture_only", STRIPE_PRICE_ID: "price_billing_fixture",
      STRIPE_WEBHOOK_SECRET: "whsec_fixture_only", PAYMENT_TEST_USER: unpaid, OPENAI_API_KEY: "fixture_only" } });
  child.stdout.on("data", chunk => { logs += chunk; }); child.stderr.on("data", chunk => { logs += chunk; });
  let port;
  for (let i = 0; i < 150; i++) {
    port = logs.match(/BILLING_TEST_PORT=(\d+)/u)?.[1];
    if (port) break;
    assert.equal(child.exitCode, null, "Isolated production payment server exited");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(port, "Isolated payment server did not start");
  const base = `http://127.0.0.1:${port}`;
  const request = (url, who, body, extra = {}) => fetch(base + url, {
    method: body === undefined ? "GET" : "POST", redirect: "manual",
    headers: { "X-Forwarded-Host": "neurotext.uk", "X-Forwarded-Proto": "https", "X-Neurotext-Request": "1",
      ...(who ? { Cookie: who } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const status = async who => (await request("/api/billing/status", who)).json();
  assert.equal((await status()).fullAccess, false);
  assert.equal((await request("/api/auth/me")).status, 200);
  assert.equal((await (await request("/api/auth/me", ownerCookie)).json()).owner, true);
  assert.equal((await status(ownerCookie)).fullAccess, true, "Designated verified owner must not need Stripe or OWNER_EMAIL env");
  await pool.query("INSERT INTO neurotext_billing(user_id,access_status,access_until) VALUES($1,'paid',now()-interval '1 day')", [owner]);
  assert.equal((await status(ownerCookie)).fullAccess, true, "Expired billing must never revoke owner access");
  await pool.query("UPDATE neurotext_billing SET access_status='unpaid' WHERE user_id=$1", [owner]);
  assert.equal((await status(ownerCookie)).fullAccess, true, "Unpaid, cancelled or refunded billing must never revoke owner access");
  assert.equal((await (await request("/api/usage", ownerCookie)).json()).accessState, "owner");
  assert.equal((await status(userCookie)).fullAccess, false, "Google sign-in alone is not paid access");
  assert.equal((await request("/api/billing/checkout", undefined, {})).status, 401);
  assert.equal((await (await request("/api/usage", undefined, undefined, { "X-Forwarded-Host": "spoof.replit.dev" })).json()).accessState, "anonymous");
  assert.equal((await request("/api/billing/confirm", otherCookie, { sessionId: "cs_test_foreign" })).status, 409);
  const savedFull = Array.from({ length: 200 }, (_, i) => `saved${i}`).join(" ") + " SAVED_FULL_TAIL";
  await pool.query("INSERT INTO neurotext_workspaces(session_id,function_id,payload) VALUES($1,1,$2)", [
    `user:${unpaid}`, JSON.stringify({ instructions: "My paper", sourceDocument: "", output: savedFull, skeleton: "HIDDEN_OUTLINE_TAIL", targetWords: 4000, status: "complete" }),
  ]);
  const hiddenWorkspace = await (await request("/api/functions/workspaces/1", userCookie)).json();
  assert(!hiddenWorkspace.output.includes("SAVED_FULL_TAIL"), "Saved full answers must not leak after access expires");
  assert.equal(hiddenWorkspace.skeleton, "");
  assert(hiddenWorkspace.output.includes("[Preview only"));
  const input = { functionId: 10, instructions: "Do the assignment", sourceDocument: "", targetWords: 100, selectedModel: "ZHI 1 · OpenAI", thinker: "" };
  const generate = async (who, patch = {}) => {
    const response = await request("/api/functions/stream", who, { ...input, ...patch });
    assert.equal(response.status, 200);
    const frames = (await response.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    assert(!frames.some(frame => frame.type === "error"), JSON.stringify(frames.filter(frame => frame.type === "error")));
    return { text: frames.filter(frame => frame.type === "token").map(frame => frame.content).join(""), done: frames.find(frame => frame.type === "complete") };
  };
  const preview = await generate(userCookie);
  assert.equal(preview.done.preview, true);
  assert.equal(preview.text.split("\n\n[Preview only")[0].split(/\s+/u).length, 100);
  assert(!preview.text.includes("FULL_ANSWER_TAIL"));
  const long = await generate(undefined, { functionId: 9, targetWords: 45000 });
  assert(long.text.split("\n\n[Preview only")[0].split(/\s+/u).length < 20);
  assert(!long.text.includes("FULL_ANSWER_TAIL"));
  assert.equal((await request("/api/functions/stream", userCookie, { ...input, resumeFrom: preview.text })).status, 402);
  assert((await generate(ownerCookie)).text.includes("FULL_ANSWER_TAIL"), "Owner must receive 100% of the answer");
  const finderInput = { functionId: 14, instructionDraft: "Knowledge need not always depend on inference. Perception supplies knowledge directly.",
    sourceDocument: "Direct awareness is not an inference from prior beliefs. Inferential knowledge depends on other propositions.", instructions: "Focus on direct versus inferential knowledge.", targetWords: 500 };
  const found = await generate(ownerCookie, finderInput);
  assert(found.text.includes("How to use it:"));
  assert(found.done.reportProof);
  const rewriteDirections = "Preserve my voice and expand the objections section.";
  const rewritten = await generate(ownerCookie, { ...finderInput, relevanceAction: "rewrite", relevanceReport: found.text, reportProof: found.done.reportProof, rewriteInstructions: rewriteDirections });
  assert(rewritten.text.includes(finderInput.instructionDraft));
  assert(rewritten.text.includes("The supplied source (Box B)"));
  const originalWorkspace = await (await request("/api/functions/workspaces/14", ownerCookie)).json();
  const savedRewriteDirections = await fetch(base + "/api/functions/workspaces/14", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie, "X-Forwarded-Proto": "https", "X-Neurotext-Request": "1" },
    body: JSON.stringify({ ...originalWorkspace, ...finderInput, relevanceReport: found.text, output: found.text, reportProof: found.done.reportProof, rewriteInstructions: rewriteDirections }),
  });
  assert.equal(savedRewriteDirections.status, 200);
  const restoredDirections = await (await request("/api/functions/workspaces/14", ownerCookie)).json();
  assert.equal(restoredDirections.rewriteInstructions, rewriteDirections, "Rewrite directions must survive saving and reloading");
  assert.equal(restoredDirections.reportProof, found.done.reportProof, "Saving rewrite directions must preserve report reuse");
  assert.equal((await request("/api/functions/stream", ownerCookie, { ...input, ...finderInput, instructions: "Changed instructions", relevanceAction: "rewrite", relevanceReport: found.text, reportProof: found.done.reportProof })).status, 400);
  assert.equal((await request("/api/functions/stream", userCookie, { ...input, ...finderInput, relevanceAction: "rewrite", relevanceReport: found.text, reportProof: found.done.reportProof })).status, 402);
  const checkout = await request("/api/billing/checkout", userCookie, {});
  assert.equal(checkout.status, 200);
  assert.match((await checkout.json()).url, /^https:\/\/checkout\.stripe\.com\//u);
  assert.equal((await status(userCookie)).fullAccess, false, "Opening checkout must not grant access");
  await request("/?checkout=success", userCookie);
  assert.equal((await status(userCookie)).fullAccess, false, "A forged return URL must not grant access");
  await request("/__billing_fixture", undefined, { settled: true, active: true });
  assert.equal((await request("/api/billing/confirm", otherCookie, { sessionId: "cs_test_billing_primary" })).status, 409);
  assert.equal((await request("/api/billing/confirm", userCookie, { sessionId: "cs_test_billing_primary" })).status, 200);
  assert.equal((await status(userCookie)).fullAccess, true);
  assert((await (await request("/api/functions/workspaces/1", userCookie)).json()).output.includes("SAVED_FULL_TAIL"));
  assert((await generate(userCookie)).text.includes("FULL_ANSWER_TAIL"), "Verified payment must unlock complete output");
  await request("/__billing_fixture", undefined, { active: false });
  const event = JSON.stringify({ id: "evt_billing_fixture", type: "customer.subscription.deleted", data: { object: { customer: "cus_billing_fixture" } } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: event, secret: "whsec_fixture_only" });
  const webhook = sig => fetch(base + "/api/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": sig }, body: event });
  assert.equal((await webhook("invalid")).status, 400);
  assert.equal((await status(userCookie)).fullAccess, true, "Invalid webhooks must not change access");
  assert.equal((await webhook(signature)).status, 200);
  assert.equal((await status(userCookie)).fullAccess, false, "Cancellation must revoke access");
  assert.equal((await status(ownerCookie)).fullAccess, true, "Stripe cancellation processing must not affect the owner exemption");
  assert.equal((await webhook(signature)).status, 200);
  assert.equal((await status(userCookie)).fullAccess, false, "A replay must not resurrect cancelled access");
  console.log("PASS: production owner exemption, no development-host spoofing, Google-only denial, exact half previews, long previews below 10%, no hidden full SSE output, resume denial, checkout ownership, verified payment unlock, signed cancellation, replay safety and no live Stripe charges.");
  if (process.argv.includes("--serve")) {
    await writeFile("/tmp/neurotext-billing-browser-fixture.json", JSON.stringify({ base, ownerCookie, userCookie }), { mode: 0o600 });
    console.log("BILLING_BROWSER_FIXTURE_READY");
    await new Promise(resolve => { process.once("SIGTERM", resolve); child.once("exit", resolve); });
  }
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await pool.query("DELETE FROM neurotext_sessions WHERE sid=ANY($1::varchar[])", [sessionIds]);
  await pool.query("DELETE FROM neurotext_workspaces WHERE session_id=ANY($1::text[])", [ids.map(id => `user:${id}`)]);
  await pool.query("DELETE FROM neurotext_usage WHERE session_id=ANY($1::text[])", [ids.map(id => `user:${id}`)]);
  await pool.query("DELETE FROM neurotext_users WHERE id=ANY($1::text[])", [ids]);
  await pool.end();
  await rm(entry, { force: true });
  if (process.argv.includes("--serve")) await rm("/tmp/neurotext-billing-browser-fixture.json", { force: true });
}
