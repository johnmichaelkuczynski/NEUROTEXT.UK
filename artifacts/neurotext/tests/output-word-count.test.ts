import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { countOutputWords } from "../src/lib/output-word-count.ts";

test("empty or formatting-only outputs contain zero words", () => {
  for (const text of ["", " \n\t ", "# ** --- > ..."]) assert.equal(countOutputWords(text), 0);
});

test("counts the complete document across paragraphs without Markdown-only tokens", () => {
  assert.equal(countOutputWords("# Abstract\n\n**This is a dissertation.**\n\n---"), 5);
  assert.equal(countOutputWords("Don't split well-researched words or 20,000."), 6);
  assert.equal(countOutputWords("one\t two\nthree"), 3);
});

test("updates correctly for streamed, replaced, rewritten, and cleared outputs", () => {
  assert.deepEqual(["", "The", "The paper", "A completely rewritten output.", ""].map(countOutputWords), [0, 1, 2, 4, 0]);
});

test("counts full dissertation-length outputs rather than the visible excerpt", () => {
  assert.equal(countOutputWords("word ".repeat(45000)), 45000);
});

test("every writing-page implementation and live popup includes the counter", () => {
  for (const name of ["document-creator", "document-transformer", "screenplay-generator", "masters-thesis-creator", "maximum-intelligence-rewrite", "cognitive-profiling", "coherence-evaluator", "translator", "neurotext"]) {
    const source = readFileSync(new URL(`../src/pages/${name}.tsx`, import.meta.url), "utf8");
    assert.ok(source.includes("<OutputWordCount text={output}"), name);
  }
  const popup = readFileSync(new URL("../src/components/live-generation-popup.tsx", import.meta.url), "utf8");
  assert.ok(popup.includes("<OutputWordCount text={visible}"));
});
