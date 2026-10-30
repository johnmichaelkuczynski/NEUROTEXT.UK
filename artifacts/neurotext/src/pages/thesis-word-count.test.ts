import assert from "node:assert/strict";
import test from "node:test";
import { parseThesisWordCount, wordCountError } from "./thesis-word-count.ts";

test("recognizes common ways to specify the full 20,000-word allowance", () => {
  for (const text of ["20,000 words", "20000 words", "20k words", "length: 20k", "word count: 20000", "20,000-word thesis", "twenty thousand words"]) {
    assert.deepEqual(parseThesisWordCount(text), { ok: true, words: 20000 }, text);
  }
});

test("rejects over-limit requests instead of silently shortening them", () => {
  for (const text of ["20001 words", "21k words", "length: 30,000", "twenty one thousand words"]) {
    assert.deepEqual(parseThesisWordCount(text), { ok: false, reason: "over" }, text);
  }
});

test("requires a positive whole word count, not a topic date", () => {
  for (const text of ["0 words", "-5 words", "2.5 words", "word count: 20,000.5", "length: abc", "History of Europe, 1914-1918"]) {
    assert.equal(parseThesisWordCount(text).ok, false, text);
  }
  assert.deepEqual(parseThesisWordCount("Research problem: 1,500 words"), { ok: true, words: 1500 });
});

test("dissertation parsing uses a 45,000-word maximum without loosening thesis defaults", () => {
  for (const text of ["45,000 words", "45000 words", "45k words", "length: 45k", "forty five thousand words"]) {
    assert.deepEqual(parseThesisWordCount(text, 45000), { ok: true, words: 45000 }, text);
    assert.deepEqual(parseThesisWordCount(text), { ok: false, reason: "over" }, text);
  }
  assert.deepEqual(parseThesisWordCount("45001 words", 45000), { ok: false, reason: "over" });
  assert.match(wordCountError({ ok: false, reason: "missing" }, 45000), /45,000/);
  assert.match(wordCountError({ ok: false, reason: "over" }, 45000), /45,000/);
  assert.match(wordCountError({ ok: false, reason: "over" }), /20,000/);
});
