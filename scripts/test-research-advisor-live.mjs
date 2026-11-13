import assert from "node:assert/strict";

const base = process.argv[2] || "http://localhost:80";
const onlyCase = process.argv[3];
const request = (input) => fetch(`${base}/api/functions/stream`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(input), signal: AbortSignal.timeout(180000),
});
const common = { functionId: 13, instructions: "", instructionDraft: "", sourceDocument: "", targetWords: 500,
  selectedModel: "ZHI 6 · Perplexity Sonar Pro", thinker: "Standard NEUROTEXT style", quotationCount: 0 };
const workspaces = await (await fetch(`${base}/api/functions/workspaces`)).json();
assert.equal(workspaces.length, 13);
const workspace = workspaces.find(item => item.functionId === 13);
assert.equal(workspace.targetWords, 1500);
assert.equal(workspace.selectedModel, common.selectedModel);
for (const [patch, status] of [
  [{}, 400], [{ sourceDocument: "Supporting materials are not the user's project." }, 400],
  [{ instructions: "An idea", resumeFrom: "An old report" }, 400],
  [{ instructionDraft: "word ".repeat(20001) }, 413],
  [{ instructions: "word ".repeat(20001) }, 413],
]) assert.equal((await request({ ...common, ...patch })).status, status);
const transfer = await fetch(`${base}/api/functions/transfer`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sourceFunctionId: 11, destinationFunctionId: 13, document: "An OCR manuscript about causation." }),
});
assert.equal(transfer.status, 200);
const destination = (await transfer.json()).destination;
assert.equal(destination.instructionDraft, "An OCR manuscript about causation.");
assert.equal(destination.instructions, "");
assert.equal(destination.sourceDocument, "");
for (const [name, patch] of [
  ["idea-only", { instructions: "My paper argues that causal laws cannot be reduced to observed regularities: logical dependence between propositions must be distinguished from causal dependence between events." }],
  ["rough-draft-only", { instructionDraft: "My thesis concerns Darwinian evolution. Natural selection explains adaptation but should not be confused with progress toward a predetermined goal. I distinguish mechanisms of selection from philosophical claims about purpose and want to address rival accounts without abandoning this distinction." }],
]) {
  if (onlyCase && name !== onlyCase) continue;
  const response = await request({ ...common, ...patch });
  assert.equal(response.status, 200);
  const events = (await response.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  const error = events.find(event => event.type === "error");
  assert.ok(!error, `${name}: ${error?.message}`);
  assert.ok(events.some(event => event.type === "complete" && event.validated));
  const report = events.filter(event => event.type === "token").map(event => event.content).join("");
  assert.match(report, /A\. Canonical books to address/);
  assert.match(report, /B\. Points to address/);
  assert.match(report, /Canonical relevance:/);
  assert.match(report, /What to address:/);
  assert.match(report, /How to address it:/);
  assert.match(report, /objection/i);
  console.log(JSON.stringify({ case: name, provider: events.find(event => event.type === "complete").provider,
    words: report.split(/\s+/u).length, report }));
}
console.log(`PASS: real default-provider ${onlyCase || "idea-only and draft-only"} research reports; 13 workspaces, no login wall, required project, size limits, fresh-report handling and OCR-to-draft transfer.`);
