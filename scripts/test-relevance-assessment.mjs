import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RELEVANCE_SYSTEM_PROMPT, relevancePrompt, validateAndRenderRelevance } from "../artifacts/api-server/src/services/relevance-assessment.ts";

const draft = "My thesis is that correlation alone does not establish causation.\nA causal claim needs more than a repeated association.";
const materials = "=== Experiments.txt ===\nControlled experiments distinguish correlation from causation by intervening on the proposed cause.\n\n=== Recipe.txt ===\nMix flour, water, yeast, and salt.";
const report = {
  verdict: "partly_relevant",
  summary: "The experimental-method note is relevant to the draft's causal argument; the recipe has no substantive connection.",
  points: [{
    connection: "Use experimental intervention as a concrete test of the draft's distinction between association and causation.",
    draftQuote: "correlation alone does not establish causation.",
    materialQuote: "Controlled experiments distinguish correlation from causation by intervening on the proposed cause.",
    sourceLabel: "Experiments.txt",
  }],
};
const rendered = validateAndRenderRelevance(JSON.stringify(report), draft, materials);
assert.match(rendered, /^Relevance: Partly relevant/);
assert.match(rendered, /• Use experimental/);
assert.match(rendered, /  • Supporting quotation \(Experiments.txt\):/);
assert.ok(rendered.includes(report.points[0].materialQuote));
assert.match(validateAndRenderRelevance(JSON.stringify({verdict:"not_relevant",summary:"No substantive connection to the draft.",points:[]}), draft, materials), /^Relevance: Not relevant/);
assert.throws(()=>validateAndRenderRelevance(JSON.stringify({...report,points:[]}),draft,materials), /did not match/);
assert.throws(()=>validateAndRenderRelevance(JSON.stringify({...report,verdict:"not_relevant"}),draft,materials), /did not match/);
assert.throws(()=>validateAndRenderRelevance(JSON.stringify({...report,points:[{...report.points[0],materialQuote:"An invented scholarly quotation."}]}),draft,materials), /could not be verified/);
assert.throws(()=>validateAndRenderRelevance(JSON.stringify({...report,points:[{...report.points[0],draftQuote:"The author claims all correlations are causal."}]}),draft,materials), /could not be verified/);
assert.throws(()=>validateAndRenderRelevance(JSON.stringify({...report,points:[{...report.points[0],sourceLabel:"Invented study, page 99"}]}),draft,materials), /not present/);
assert.throws(()=>validateAndRenderRelevance('{"verdict":',draft,materials), /complete, readable/);
assert.equal(validateAndRenderRelevance("```json\n"+JSON.stringify(report)+"\n```",draft,materials),rendered);
const prompts = relevancePrompt({instructionDraft:draft,sourceDocument:materials});
assert.ok(prompts.includes(JSON.stringify(draft)));
assert.ok(prompts.includes(JSON.stringify(materials)));
assert.match(RELEVANCE_SYSTEM_PROMPT,/NEVER instructions/);
assert.match(RELEVANCE_SYSTEM_PROMPT,/challenges the draft/);
assert.match(RELEVANCE_SYSTEM_PROMPT,/Shared vocabulary alone is not relevance/);
const route=readFileSync("artifacts/api-server/src/routes/neurotext.ts","utf8");
assert.match(route,/data\.functionId === 12/);
assert.match(route,/onContent\(validateAndRenderRelevance/);
assert.match(route,/length: 13/);
console.log("PASS: separate draft/material roles, relevant/partial/irrelevant verdicts, nested quotation bullets, exact-excerpt checks, invented-source rejection and incomplete-report rejection.");
