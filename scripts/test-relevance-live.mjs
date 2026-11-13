import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const base = process.argv[2] || "http://localhost:80";
const onlyCase = process.argv[3];
const draft = "My thesis is that correlation alone does not establish causation. A causal claim needs more than a repeated association.";
const article = "Controlled experiments distinguish correlation from causation by intervening on the proposed cause. Random allocation helps rule out confounding explanations.";
const recipe = "To bake bread, mix flour, water, yeast, and salt. Knead the dough and let it rise before baking.";
const common = { functionId:12, instructions:"", instructionDraft:draft, sourceDocument:article, targetWords:500, selectedModel:"ZHI 6 · Perplexity Sonar Pro", thinker:"Standard NEUROTEXT style", quotationCount:0 };
for (const [name, patch] of [
  ["missing-a",{instructionDraft:""}], ["missing-b",{sourceDocument:""}],
  ["ocr-is-not-a-writing-function",{functionId:11}],
  ["unsupported-resume",{resumeFrom:"An old report"}],
]) {
  const res=await fetch(base+"/api/functions/stream",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...common,...patch})});
  assert.equal(res.status,400,name);
}
const oversized = await fetch(base+"/api/functions/stream",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...common,instructionDraft:"word ".repeat(20001)})});
assert.equal(oversized.status,413);

for (const [name, materials, verdict] of [
  ["positive", article, /^Relevance: (Relevant|Partly relevant)/],
  ["negative", recipe, /^Relevance: Not relevant/],
  ["mixed", `=== Experiments.txt ===\n\n${article}\n\n=== Recipe.txt ===\n\n${recipe}`, /^Relevance: (Relevant|Partly relevant)/],
]) {
  if (onlyCase && name !== onlyCase) continue;
  const res=await fetch(base+"/api/functions/stream",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...common,sourceDocument:materials}),signal:AbortSignal.timeout(150000)});
  assert.equal(res.status,200);
  const events=(await res.text()).split("\n").filter(line=>line.startsWith("data: ")).map(line=>JSON.parse(line.slice(6)));
  const error=events.find(e=>e.type==="error");
  assert.ok(!error,`${name}: ${error?.message}`);
  assert.ok(events.some(e=>e.type==="complete"&&e.validated),`${name}: validated completion`);
  const report=events.filter(e=>e.type==="token").map(e=>e.content).join("");
  assert.match(report,verdict,name);
  if(name!=="negative"){
    assert.match(report,/• /);
    assert.match(report,/  • Supporting quotation/);
    if (name === "mixed") {
      assert.match(report,/Recipe/i);
      assert.match(report,/\b(not relevant|irrelevant|unrelated|no substantive)\b/i);
    }
  } else {
    assert.doesNotMatch(report,/Points of relevance/);
    assert.ok(report.split(/\s+/u).length<100,"An irrelevant verdict must not be padded to meet a word target");
  }
  writeFileSync(`/tmp/neurotext-relevance-live-${name}.json`,JSON.stringify({report,events}));
  console.log(JSON.stringify({case:name,verdict:report.split("\n")[0],words:report.split(/\s+/u).length,provider:events.find(e=>e.type==="complete")?.provider}));
}
console.log("PASS: real default-provider relevance, irrelevance and mixed-material reports; required inputs, OCR exclusion, size limits and short-report completion.");
