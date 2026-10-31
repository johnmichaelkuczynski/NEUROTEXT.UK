import assert from "node:assert/strict";
import test from "node:test";
import { runFunctionDiagnostics, initialDiagnosticResults, type DiagnosticResult } from "../src/lib/function-diagnostics.ts";
import { DIAGNOSTIC_CASES } from "../src/lib/diagnostic-cases.ts";

test("coverage includes every function page, original objections, and every rewrite", () => {
  for (let page = 2; page <= 15; page++) assert.ok(DIAGNOSTIC_CASES.some(item => item.path === `/page-${page}`));
  assert.ok(DIAGNOSTIC_CASES.some(item => item.id === "objections"));
  assert.equal(initialDiagnosticResults("ZHI 1").length, DIAGNOSTIC_CASES.length * 2);
  assert.equal(new Set(DIAGNOSTIC_CASES.map(item => item.id)).size, DIAGNOSTIC_CASES.length);
  const academic = DIAGNOSTIC_CASES.filter(item => item.preview);
  assert.equal(academic.length, 4);
  assert.ok(academic.every(item => item.body.diagnosticPreview === true));
});

function response(parts: string[], done = true, preview = false) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const text of parts) controller.enqueue(encoder.encode(JSON.stringify({ type: "token", text }) + "\n"));
      if (done) controller.enqueue(encoder.encode(JSON.stringify({ type: "done", diagnosticPreview: preview }) + "\n"));
      controller.close();
    },
  }));
}

test("multiple network text reads count as incremental even for a very short response", async () => {
  const results: DiagnosticResult[] = [];
  await runFunctionDiagnostics({ provider: "ZHI 1", signal: new AbortController().signal, caseIds: ["manipulator"],
    fetcher: async () => response(["The blue balloon ", "rose above the green hill."]),
    onUpdate: result => { results.push(result); },
  });
  const final = results.filter(row => row.status === "passed");
  assert.equal(final.length, 2);
  assert.ok(final.every(row => row.streaming === "incremental" && row.textReads === 2));
});

test("missing completion fails and skips revision rather than falsely passing partial text", async () => {
  const results: DiagnosticResult[] = [];
  await runFunctionDiagnostics({ provider: "ZHI 1", signal: new AbortController().signal, caseIds: ["manipulator"],
    fetcher: async () => response(["The blue balloon rose above the green hill."], false),
    onUpdate: result => { results.push(result); },
  });
  assert.equal(results.at(-2)?.status, "failed");
  assert.equal(results.at(-1)?.status, "skipped");
  assert.match(results.at(-2)?.error ?? "", /without a completion event/);
});

test("academic samples cannot pass unless the server acknowledges the sample limit", async () => {
  const results: DiagnosticResult[] = [];
  await runFunctionDiagnostics({ provider: "ZHI 1", signal: new AbortController().signal, caseIds: ["thesis-creator"],
    fetcher: async () => response(["Abstract: " + "A substantive sample paragraph. ".repeat(25)]),
    onUpdate: result => { results.push(result); },
  });
  assert.ok(results.some(row => row.status === "failed" && row.checks.some(check => check.includes("did not acknowledge"))));
});
