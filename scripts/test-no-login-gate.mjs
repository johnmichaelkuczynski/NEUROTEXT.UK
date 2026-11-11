import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual production handler without paid provider calls or real data.
const source = readFileSync("artifacts/api-server/src/routes/neurotext.ts", "utf8");
const start = source.indexOf("async function streamGeneration(");
const end = source.indexOf('\nrouter.get("/functions/workspaces"', start);
assert.ok(start >= 0 && end > start);
const handler = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
for (const operationsUsed of [0, 3, 1000]) {
  const events = [];
  const writes = [];
  const input = {
    functionId: 1, targetWords: 4000, instructions: "Continue the document.",
    sourceDocument: "", selectedModel: "test", resumeFrom: "word ".repeat(4000),
  };
  const schema = { safeParse: () => ({ success: true, data: input }) };
  const context = vm.createContext({
    process: { env: { NODE_ENV: "production" } },
    StreamFunctionBody: schema, StreamCoherenceBody: schema,
    separateLegacyDraft: value => value, MINIMUMS: [4000],
    sessionId: () => "isolated-test-session",
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ operationsUsed }] }) }) }),
      insert: () => ({ values: value => ({
        onConflictDoUpdate: async update => writes.push({ value, update }),
      }) }),
    },
    neurotextUsage: { sessionId: "sessionId" }, eq: () => true,
    createLiveDocumentStream: () => ({
      send: event => events.push(event), isClosed: () => false, finish: () => {},
    }),
    wordCount: value => value.trim().split(/\s+/).length,
    selectedProvider: () => ({ kind: "openai", name: "test" }),
    academicChapterCount: () => 0,
  });
  vm.runInContext(`${handler}\nthis.run = streamGeneration;`, context);
  const req = { body: input, log: { error: () => {} } };
  const res = { status: code => { throw new Error(`Unexpected HTTP ${code}`); } };
  await context.run(req, res);
  assert.ok(events.some(event => event.type === "complete"), JSON.stringify(events));
  assert.ok(!events.some(event => event.type === "error"), JSON.stringify(events));
  assert.equal(writes.length, 1);
}
assert.ok(!source.includes("Sign in to continue"));
assert.match(source, /operationsRemaining:\s*-1/);
console.log("PASS: production generation accepts anonymous sessions with 0, 3 and 1,000 prior operations; usage tracking remains intact.");
