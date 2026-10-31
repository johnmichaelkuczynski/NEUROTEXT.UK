import assert from "node:assert/strict";
import test from "node:test";
import { isTranslationFunction, translationPartPrompt, translationRequestError, translationSeparator, splitTranslationText, translationWordTarget, mergeTranslationTerminology, translationTerminologyPrompt } from "./translation.ts";

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

test("early ambiguous terms and names survive beyond the 1800-character continuity window", () => {
  const source = "La portance dépend du profil de l’aile. Émile Lenoir mesure la portance.";
  const firstOutput = "Lift depends on the airfoil. Émile Lenoir measures lift. " + "The measurements remain stable. ".repeat(100);
  const terms = mergeTranslationTerminology([], JSON.stringify([
    { source: "portance", target: "lift" }, { source: "profil", target: "airfoil" },
    { source: "Émile Lenoir", target: "Émile Lenoir" },
  ]), source, firstOutput, false);
  assert.ok(!firstOutput.slice(-1800).includes("airfoil"));
  const prompt = translationPartPrompt({
    revision: false, source: "La portance dépend toujours du profil.", index: 2, total: 3,
    proportion: 0.3, previousTranslation: firstOutput, terminology: terms,
    instructions: "Translate into English; use a literary style. Shorten by 25%.",
    targetWords: 20,
  });
  assert.match(prompt, /"source":"profil","target":"airfoil"/);
  assert.match(prompt, /"source":"portance","target":"lift"/);
  assert.match(prompt, /"source":"Émile Lenoir","target":"Émile Lenoir"/);
  assert.match(prompt, /literary style/);
  assert.match(prompt, /approximately 20 words/);
  assert.match(prompt, /Shortening may omit material/);
});

test("established mappings do not drift but a critique-driven revision can update a known source identity", () => {
  const original = [{ source: "Geist", target: "spirit" }];
  assert.deepEqual(mergeTranslationTerminology(original, '[{"source":"Geist","target":"mind"}]', "Geist", "mind", false), original);
  const revised = mergeTranslationTerminology(original, '[{"source":"Geist","target":"mind"}]', "spirit", "mind", true);
  assert.deepEqual(revised, [{ source: "Geist", target: "mind" }]);
  assert.deepEqual(mergeTranslationTerminology(revised, "[]", "Unrelated passage.", "Unrelated passage.", true), revised);
  const prompt = translationPartPrompt({
    revision: true, source: "The spirit perceives.", index: 0, total: 2, proportion: 0.5,
    previousTranslation: "", terminology: original,
    instructions: 'Be literal. Translate "Geist" as "mind", not "spirit".',
  });
  assert.match(prompt, /latest critique overrides original preferences/);
  assert.match(prompt, /Be literal/);
  assert.match(prompt, /Translate "Geist" as "mind"/);
  assert.match(prompt, /changes the target language/);
});

test("terminology extraction is grounded, additive, Unicode-aware and never drops early entries", () => {
  const existing = [{ source: "GEIST", target: "spirit" }];
  const merged = mergeTranslationTerminology(existing, JSON.stringify([
    { source: "Geist", target: "mind" },
    { source: "Körper", target: "body" },
    { source: "invented", target: "body" },
    { source: "Seele", target: "not in output" },
  ]), "Geist, Körper und Seele", "mind, body and soul", false);
  assert.deepEqual(merged, [...existing, { source: "Körper", target: "body" }]);
  assert.deepEqual(mergeTranslationTerminology(merged, "```json\n[]\n```", "", "", false), merged);
  assert.throws(() => mergeTranslationTerminology([], "not JSON", "", "", false), /terminology could not be read/);
  assert.throws(() => mergeTranslationTerminology([], '{"source":"Geist"}', "", "", false), /Invalid/);
  assert.throws(() => mergeTranslationTerminology([], '[{"source":"","target":"mind"}]', "", "", false), /Invalid/);
  const prompt = translationTerminologyPrompt({
    source: "Geist", output: "mind", terminology: existing, revision: true,
    instructions: "Use mind for Geist.",
  });
  assert.match(prompt, /"source":"Geist","output":"mind"/);
  assert.match(prompt, /Use mind for Geist/);
  assert.match(prompt, /critique explicitly changes a known term/);
});
