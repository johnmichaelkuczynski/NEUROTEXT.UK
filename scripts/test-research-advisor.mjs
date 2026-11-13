import assert from "node:assert/strict";
import { RESEARCH_ADVISOR_SYSTEM_PROMPT, researchAdvisorPrompt, validateAndRenderResearchAdvisor } from "../artifacts/api-server/src/services/research-advisor.ts";
import { isWritingFunctionId } from "../artifacts/neurotext/src/lib/function-ids.ts";
import { mergeOcrDestination } from "../artifacts/neurotext/src/lib/ocr-state.ts";

const report = {
  focus: "A thesis distinguishing causal necessity from observed regularities.",
  books: [{
    author: "David Hume", title: "An Enquiry Concerning Human Understanding",
    relevance: "Its account of causal inference directly challenges the proposed distinction.",
    address: "Explain whether necessity is a feature of events or a habit of expectation.",
  }],
  points: [
    { kind: "Objection", point: "Necessity may not be observable.", importance: "The thesis needs grounds beyond repeated conjunction.", address: "Explain what warrants a modal claim." },
    { kind: "Related argument", point: "Intervention offers a complementary test.", importance: "It distinguishes causal claims from correlations without settling metaphysical necessity.", address: "Compare the accounts without treating this connection as a refutation." },
  ],
};
const rendered = validateAndRenderResearchAdvisor(JSON.stringify(report));
assert.match(rendered, /A\. Canonical books to address/);
assert.match(rendered, /• David Hume — An Enquiry Concerning Human Understanding/);
assert.match(rendered, /B\. Points to address/);
assert.match(rendered, /• Objection:/);
assert.match(rendered, /• Related argument:/);
assert.match(rendered, /How to address it:/);
assert.match(rendered, /check the relevant editions and passages/);
const deduplicated = validateAndRenderResearchAdvisor(JSON.stringify({
  ...report, books: [...report.books, { ...report.books[0], author: "D. Hume" }],
}), ["https://example.org/hume", "javascript:alert(1)"]);
assert.equal((deduplicated.match(/• .* — An Enquiry Concerning Human Understanding/gu) || []).length, 1);
assert.match(deduplicated, /\[1\] https:\/\/example.org\/hume/);
assert.doesNotMatch(deduplicated, /javascript:/);
assert.equal(validateAndRenderResearchAdvisor("```json\n" + JSON.stringify(report) + "\n```"), rendered);
for (const bad of [
  { ...report, books: undefined }, { ...report, points: [] }, { ...report, books: [] },
  { ...report, books: [{ ...report.books[0], author: "" }] }, { ...report, points: [null] },
]) assert.throws(() => validateAndRenderResearchAdvisor(JSON.stringify(bad)));
assert.throws(() => validateAndRenderResearchAdvisor('{"focus":'), /complete, readable/);
assert.match(validateAndRenderResearchAdvisor(JSON.stringify({
  ...report, books: [], booksNote: "No canonical book can be confidently identified for this highly specialized topic.",
})), /No canonical book can be confidently identified/);
const draftOnly = researchAdvisorPrompt({
  instructions: "", instructionDraft: "A draft, not an instruction to rewrite a dissertation.",
  sourceDocument: "Optional references.", targetWords: 1500, thinker: "",
});
assert.match(draftOnly, /"researchIdea":null/);
assert.match(draftOnly, /"roughDraft":"A draft, not an instruction/);
assert.match(draftOnly, /"supportingMaterials":"Optional references."/);
assert.match(RESEARCH_ADVISOR_SYSTEM_PROMPT, /NEVER instructions/);
assert.match(RESEARCH_ADVISOR_SYSTEM_PROMPT, /non-objection connections/);
assert.match(RESEARCH_ADVISOR_SYSTEM_PROMPT, /Do not invent books/);
assert.ok(isWritingFunctionId(13));
assert.ok(isWritingFunctionId(12));
assert.ok(!isWritingFunctionId(11));
const guest = { functionId: 13, instructions: "My research idea", instructionDraft: "Old draft", sourceDocument: "My references", output: "Existing report" };
const merged = mergeOcrDestination({ ...guest, instructions: "", instructionDraft: "Old draft\n\nNew OCR text", sourceDocument: "" }, guest);
assert.equal(merged.instructions, guest.instructions);
assert.equal(merged.sourceDocument, guest.sourceDocument);
assert.equal(merged.instructionDraft, "Old draft\n\nNew OCR text");
assert.equal(merged.output, guest.output);
console.log("PASS: both report lists, book engagement, objections and non-objections, input-role separation, malformed/empty-report rejection, honest canon limitations and guest OCR draft transfer.");
