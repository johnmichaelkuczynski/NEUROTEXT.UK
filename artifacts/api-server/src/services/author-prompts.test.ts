import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CORE_RULES, FUNCTION_PROMPTS, authorFunction, buildAuthorPrompt, readPromptFields, type AuthorFunction } from "./author-prompts.ts";

test("core rules and all other templates remain verbatim after the requested coherence correction", () => {
  const supplied = readFileSync(new URL("../../../../attached_assets/Pasted-INSTRUCTIONS-FOR-THE-REPLIT-AGENT-NEUROTEXT-LLM-PROMPTS_1793408684718.txt", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const sections = supplied.split(/={20,}\n[^\n]+\n={20,}\n/).slice(1).map((section) => section.trim());
  assert.equal(CORE_RULES, sections[0]);
  const templates = Object.entries(FUNCTION_PROMPTS);
  for (let index = 0; index < templates.length; index++) {
    if (templates[index][0] !== "coherence") assert.equal(templates[index][1], sections[index + 1]);
  }
  assert.equal(Object.keys(FUNCTION_PROMPTS).length, 13);
});

test("placeholder lines disappear only for empty UI fields; inserted document text is never processed", () => {
  const source = "  $& {INSTRUCTIONS}\nCONFLICT_FLAG: real quotation\n\n";
  const prompt = buildAuthorPrompt("maxintel", source, { authorPrompt: 1 });
  assert.equal(prompt.temperature, 0.2);
  assert.ok(!prompt.systemPrompt.includes("Additional instructions:"));
  assert.ok(prompt.systemPrompt.endsWith(source));
  const withInstructions = buildAuthorPrompt("maxintel", source, { authorPrompt: 1, instructions: "Keep $& and {TEXT} exactly." });
  assert.ok(withInstructions.systemPrompt.includes("Additional instructions: Keep $& and {TEXT} exactly."));
});

test("each function uses its requested temperature and no added system material", () => {
  for (const fn of Object.keys(FUNCTION_PROMPTS) as AuthorFunction[]) {
    const result = buildAuthorPrompt(fn, "SOURCE", { authorPrompt: 1, topic: "TOPIC", instructions: "TASK" }, "500");
    const expected = FUNCTION_PROMPTS[fn].replace(/\{TEXT\}/g, "SOURCE").replace(/\{TOPIC\}/g, "TOPIC").replace(/\{INSTRUCTIONS\}/g, "TASK").replace(/\{LENGTH\}/g, "500");
    assert.equal(result.systemPrompt, fn === "coherence" ? expected : `${CORE_RULES}\n\n${expected}`);
    assert.equal(result.temperature, ["maxintel", "manipulator", "coherence", "profile"].includes(fn) ? 0.2 : 0.7);
  }
});

test("coherence judges the reasoning instead of preserving the thesis or forcing a defect inventory", () => {
  const prompt = buildAuthorPrompt("coherence", "He recognizes the error but still feels afraid.", {
    authorPrompt: 1, instructions: "Assess conceptual consistency.",
  }, "200").systemPrompt;
  assert.ok(!prompt.includes(CORE_RULES));
  assert.ok(!prompt.includes("Never weaken, blur, or reverse"));
  assert.match(prompt, /SAME sense, respect, time, scope, and level/);
  assert.match(prompt, /latent understanding and conscious judgment/);
  assert.match(prompt, /counterexample or alternative explanation/);
  assert.match(prompt, /No thesis-summary section/);
  assert.match(prompt, /Additional evaluation instructions: Assess conceptual consistency/);
  assert.match(prompt, /Requested analysis length: 200/);
});

test("creation, adaptation, and current-output revision select distinct correct templates; Translator is excluded", () => {
  assert.equal(authorFunction("screenplay", "", { authorPrompt: 1 }), "screenplay");
  assert.equal(authorFunction("screenplay", "input", { authorPrompt: 1 }), "screenplay-adaptation");
  assert.equal(authorFunction("dialogue", "input", { authorPrompt: 1 }), "dialogue-adaptation");
  assert.equal(authorFunction("thesis-revision", "current", { authorPrompt: 1 }), "manipulator");
  assert.equal(authorFunction("maxintel", "current", { authorPrompt: 1, revision: true, function: "manipulator" }), "manipulator");
  for (const id of ["translator", "translation-revision", "translation"]) {
    assert.equal(authorFunction(id, "input", { authorPrompt: 1, revision: true }), undefined);
  }
  assert.equal(readPromptFields("Do this exactly").instructions, "Do this exactly");
});
