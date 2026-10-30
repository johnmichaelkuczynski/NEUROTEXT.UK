import assert from "node:assert/strict";
import test from "node:test";
import { isTranslationFunction, translationPartPrompt, translationRequestError, translationSeparator, splitTranslationText, translationWordTarget } from "./translation.ts";

test("translation input is required but extra instructions are optional", () => {
  assert.equal(translationRequestError({ functionId: "translator", text: "Bonjour." }), null);
  assert.match(translationRequestError({ functionId: "translator", text: " \n " })!, /text you want translated/);
  assert.match(translationRequestError({ functionId: "translation-revision", text: "" })!, /Generate a translation/);
  assert.match(translationRequestError({ functionId: "translator", text: "Bonjour", resumeDocument: "Hello" })!, /continuation/);
  assert.equal(isTranslationFunction("translation"), false);
  assert.equal(translationRequestError({ functionId: "creator", text: "" }), null);
});

test("multilingual chunking preserves all source characters, words, and Unicode", () => {
  for (const source of ["  Bonjour.\n\nBonne nuit. ", "one ".repeat(2000), "这是一个例子。".repeat(1200), "🙂".repeat(9000)]) {
    const parts = splitTranslationText(source);
    assert.equal(parts.join(""), source);
    assert.ok(parts.every(part => Array.from(part).length <= 4000 && (part.match(/\S+/gu)?.length ?? 0) <= 600));
  }
});

test("source boundary separators retain paragraphs without forcing every chunk into one", () => {
  assert.equal(translationSeparator("one ", "two"), " ");
  assert.equal(translationSeparator("one\n", "\ntwo"), "\n\n");
  assert.equal(translationSeparator("one\n", "two"), "\n");
});

test("translation prompts default to natural English and honor style/shortening preferences without changing source", () => {
  const base = { revision: false, source: "Bonjour. 1000 mots.", index: 0, total: 1, proportion: 1, previousTranslation: "" };
  assert.match(translationPartPrompt(base), /Target language: English/);
  assert.match(translationPartPrompt(base), /Bonjour\. 1000 mots\./);
  const revision = translationPartPrompt({ ...base, revision: true, instructions: "Target: French. Make it literal; cut length in half.", total: 3, proportion: 0.25 });
  assert.match(revision, /CURRENT TRANSLATION/);
  assert.match(revision, /cut length in half/);
  assert.match(revision, /proportional share/);
  assert.match(revision, /preserve unaffected passages/);
});

test("relative shortening has a measured target and is not reapplied on an unrelated revision", () => {
  assert.equal(translationWordTarget("Translate but cut length in half.", 154, false), 77);
  assert.equal(translationWordTarget("Reduce length by 25%.", 200, false), 150);
  assert.equal(translationWordTarget("Be literal.", 154, false), undefined);
  assert.equal(translationWordTarget("Do not cut the length in half.", 154, false), undefined);
  assert.equal(translationWordTarget("Cut length in half.", 1, false), undefined);
  assert.equal(translationWordTarget("Cut length in half.", 30, false, "这是一个需要忠实翻译的完整段落。\n".repeat(30)), undefined);
  const original = "=== BEGIN ORIGINAL USER TRANSLATION PREFERENCES ===\nCut length in half.\n=== END ORIGINAL USER TRANSLATION PREFERENCES ===";
  assert.equal(translationWordTarget(original, 80, true), undefined);
  assert.equal(translationWordTarget(original + "\n=== BEGIN REVISION INSTRUCTIONS (user's critique; apply these changes) ===\nMake it formal.\n=== END REVISION INSTRUCTIONS ===", 80, true), undefined);
  assert.equal(translationWordTarget(original + "\n=== BEGIN REVISION INSTRUCTIONS (user's critique; apply these changes) ===\nCut length in half again.\n=== END REVISION INSTRUCTIONS ===", 80, true), 40);
});
