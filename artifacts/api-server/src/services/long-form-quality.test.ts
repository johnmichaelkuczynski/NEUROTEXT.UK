import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlanStartEvent,
  createSectionStartEvent,
  extractNonNegotiableThesis,
  planLongFormBlocks,
  trimToWordCountPreservingFormatting,
  validateLongFormDocument,
  wordTargetBounds,
} from "./long-form-quality.ts";

const thesis = "Democratic institutions require material equality to preserve meaningful political freedom.";
const thesisPassage = "Democratic institutions require material equality, because only then can meaningful political freedom be preserved.";
const filler = "Careful analysis distinguishes formal permission from the material capacity to exercise a right in social practice.";

test("exact-length trimming preserves paragraph breaks", () => {
  const source = "First paragraph has several useful words here.\n\nSecond paragraph also has several useful words here.\n\nThird paragraph should be removed.";
  const trimmed = trimToWordCountPreservingFormatting(source, 14);
  assert.equal(trimmed.split(/\s+/).length, 14);
  assert.match(trimmed, /\n\n/);
  assert.equal(trimmed, "First paragraph has several useful words here.\n\nSecond paragraph also has several useful words");
});

function makePassingPaper() {
  const thirds = Array.from({ length: 3 }, (_, thirdIndex) => {
    const thirdTarget = thirdIndex === 2 ? 1666 : 1667;
    const words: string[] = [];
    let paragraphIndex = 0;
    while (words.length < thirdTarget) {
      paragraphIndex += 1;
      words.push(
        ...`${thesisPassage} ${filler} Section ${thirdIndex + 1}, development ${paragraphIndex}, advances the argument through a distinct institutional consequence and a separate practical implication.`.split(/\s+/),
      );
    }
    return words.slice(0, thirdTarget).join(" ");
  });
  return thirds.join(" ");
}

test("generation plans to the user's requested target, not the tolerance boundary", () => {
  const plan = planLongFormBlocks(5000);
  assert.equal(plan.minimumWords, 5000);
  assert.equal(plan.blocks.length, 5);
  assert.deepEqual(plan.blocks, [1000, 1000, 1000, 1000, 1000]);
  assert.ok(plan.blocks.reduce((sum, words) => sum + words, 0) >= plan.minimumWords);
});

test("stream progress reports blueprint and successive section-sized blocks", () => {
  assert.deepEqual(createPlanStartEvent(5000, 5), {
    type: "plan_start",
    targetWords: 5000,
    total: 5,
  });
  assert.deepEqual(createSectionStartEvent({
    index: 12,
    total: 5,
    generatedWords: 2400,
    targetWords: 5000,
  }), {
    type: "section_start",
    index: 12,
    total: 5,
    maxWords: 1000,
    generatedWords: 2400,
    targetWords: 5000,
  });
});

test("quality gate accepts target length and thesis continuity in all thirds", () => {
  const result = validateLongFormDocument({
    document: makePassingPaper(),
    source: thesis,
    targetWords: 5000,
    nonNegotiableThesis: thesis,
  });
  assert.equal(result.passed, true, result.failures.join("\n"));
});

test("word target bounds tighten as requested projects grow", () => {
  assert.deepEqual(wordTargetBounds(100), { minimumWords: 90, maximumWords: 110, margin: 0.1 });
  assert.deepEqual(wordTargetBounds(1000), { minimumWords: 950, maximumWords: 1050, margin: 0.05 });
  assert.deepEqual(wordTargetBounds(10000), { minimumWords: 9800, maximumWords: 10200, margin: 0.02 });
  assert.deepEqual(wordTargetBounds(100000), { minimumWords: 98000, maximumWords: 102000, margin: 0.02 });
});

test("quality gate enforces inclusive size-sensitive target margins", () => {
  const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
  for (const [target, minimum, maximum] of [[100, 90, 110], [1000, 950, 1050], [10000, 9800, 10200]] as const) {
    for (const count of [minimum, target, maximum]) {
      const result = validateLongFormDocument({ document: words(count), source: "", targetWords: target });
      assert.equal(result.passed, true, `${target}/${count}: ${result.failures.join("\n")}`);
    }
    for (const count of [minimum - 1, maximum + 1]) {
      const result = validateLongFormDocument({ document: words(count), source: "", targetWords: target });
      assert.equal(result.passed, false);
      assert.ok(result.failures.some((failure) => failure.includes(`acceptable range is ${minimum}-${maximum}`)));
    }
  }
});

test("quality gate rejects short paraphrases, repeated paragraphs, and invented citations", () => {
  const repeated = `${thesisPassage} ${filler} This paragraph contains enough words to qualify for exact duplicate detection across the completed scholarly document.`;
  const document = `${repeated}\n\n${repeated}\n\nA fabricated authority appears here (Inventor, 2026).`;
  const result = validateLongFormDocument({ document, source: thesis, targetWords: 5000, nonNegotiableThesis: thesis });
  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.includes("acceptable range is 4750-5250")));
  assert.ok(result.failures.some((failure) => failure.includes("repeated paragraph")));
  assert.ok(result.failures.some((failure) => failure.includes("unsupported citation")));
});

test("quality gate rejects thesis loss in the middle and conclusion", () => {
  const opening = `${thesisPassage} `.repeat(80);
  const unrelated = `${filler} `.repeat(300);
  const result = validateLongFormDocument({
    document: `${opening} ${unrelated} ${unrelated}`,
    source: thesis,
    targetWords: 100,
    nonNegotiableThesis: thesis,
  });
  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.includes("middle")));
  assert.ok(result.failures.some((failure) => failure.includes("conclusion")));
});

test("scholarly output cannot pass without in-text citations and a bibliography", () => {
  const result = validateLongFormDocument({
    document: makePassingPaper(),
    source: thesis,
    targetWords: 5000,
    nonNegotiableThesis: thesis,
    requireScholarlyApparatus: true,
  });
  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.includes("in-text citations")));
  assert.ok(result.failures.some((failure) => failure.includes("References or Bibliography")));
});

test("non-negotiable thesis is extracted from instructions", () => {
  assert.equal(extractNonNegotiableThesis(`Expand this paper.\n\nNON-NEGOTIABLE THESIS: ${thesis}`), thesis);
});