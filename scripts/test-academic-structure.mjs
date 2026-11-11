import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  academicChapterCount, academicFrontMatter, academicPlanFromDocument,
  academicSections, chapterHeading, parseAcademicPlan, validateAcademicDocument,
} from "../artifacts/api-server/src/services/academic-structure.ts";

const require = createRequire(resolve("artifacts/api-server/package.json"));
const { build } = require("esbuild");
async function loadBundled(entry, extra = {}) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, format: "esm",
    platform: "node", ...extra,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { generateAcademicDocument } = await loadBundled("artifacts/api-server/src/services/academic-generation.ts");
// React is bundled below; render with its matching renderer in the same bundle.
const rendered = await build({
  stdin: {
    contents: `import { createElement } from "react"; import { renderToStaticMarkup } from "react-dom/server"; import { AcademicDocument } from "./src/components/academic-document"; export const render = text => renderToStaticMarkup(createElement(AcademicDocument, {text}));`,
    resolveDir: resolve("artifacts/neurotext"), loader: "tsx",
  },
  bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", loader: { ".css": "empty" },
});
// CJS needs native Node builtins from the renderer, rather than data-URL imports.
const module = { exports: {} };
new Function("require", "module", "exports", rendered.outputFiles[0].text)(require, module, module.exports);
const render = module.exports.render;

assert.equal(academicChapterCount(9), 5);
assert.equal(academicChapterCount(8), 4);
assert.equal(academicChapterCount(1), null);
const titles = ["Problem and Thesis", "Theoretical Foundations", "Logical Dependence", "Inductive Inference", "Concluding Synthesis"];

for (const [functionId, count] of [[9, 5], [8, 4]]) {
  const plan = { title: "Theoretical Knowledge and Inductive Inference", chapters: titles.slice(0, count) };
  const data = {
    functionId, instructions: "Turn into a proper academic work.",
    instructionDraft: "The manuscript's substantive theory of inference.",
    sourceDocument: "Supporting sources.", targetWords: functionId === 9 ? 45000 : 20000,
    selectedModel: "ZHI 6 · Perplexity Sonar Pro",
  };
  let output = "";
  const calls = [];
  const generate = async (_system, prompt, emit) => {
    calls.push(prompt);
    if (prompt.includes("Return only JSON:")) {
      emit(JSON.stringify(plan));
    } else if (prompt.startsWith("Write only the reference entries")) {
      emit("Author, A. (2020). A legitimate source used in the fixture.");
    } else {
      const chapter = Number(prompt.match(/CURRENT CHAPTER: Chapter (\d+)/)[1]);
      const requested = Number(prompt.match(/Add approximately (\d+) words now/)[1]);
      emit(`The argument of chapter ${chapter} develops the theory. `);
      emit("Substantive scholarly discussion. ".repeat(Math.ceil(Math.max(80, requested) / 3)));
    }
  };
  await generateAcademicDocument({ data, generate, emit: text => { output += text; }, isClosed: () => false, status: () => {} });
  validateAcademicDocument(output, plan);
  const sections = academicSections(output, plan);
  assert.equal(sections.chapters.length, count);
  assert.ok(output.startsWith(academicFrontMatter(plan)));
  assert.equal((output.match(/^Chapter \d+:/gm) || []).length, count * 2); // TOC plus body, no additional chapters.
  assert.ok(output.endsWith("A legitimate source used in the fixture."));
  assert.deepEqual(academicPlanFromDocument(output, count), plan);
  const html = render(output);
  assert.ok(html.includes('<nav aria-label="Table of contents"'));
  assert.equal((html.match(/id="academic-chapter-\d+"/g) || []).length, count);
  assert.ok(html.includes('id="academic-references"'));
  assert.equal((html.match(/<h1/g) || []).length, 1);
  assert.ok(calls.filter(prompt => prompt.includes("CURRENT CHAPTER:")).length > count);
  assert.ok(sections.chapters.every(chapter => chapter.trim().split(/\s+/).length > 4000));
  assert.ok(calls.filter(prompt => prompt.includes("CURRENT CHAPTER:")).every(prompt => prompt.includes("Do not repeat them, start another chapter")));

  // Resume an interrupted chapter without duplicating title, TOC or headings.
  const partial = `${academicFrontMatter(plan)}${chapterHeading(plan, 0)}\n\nAn unfinished argument.`;
  let resumed = partial;
  await generateAcademicDocument({ data: {...data, resumeFrom:partial}, generate, emit: text => { resumed += text; }, isClosed: () => false, status: () => {} });
  validateAcademicDocument(resumed, plan);
  assert.equal((resumed.match(/Table of Contents/g) || []).length, 1);

  await assert.rejects(generateAcademicDocument({
    data,
    generate: async (_system, prompt, emit) => emit(prompt.includes("Return only JSON:") ? JSON.stringify(plan) : "Chapter 6: An unauthorized extra chapter\n\nText."),
    emit: () => {}, isClosed: () => false, status: () => {},
  }), /unexpected chapter/);
}

assert.throws(() => parseAcademicPlan(JSON.stringify({title:"Title",chapters:titles}),4), /exactly 4/);
assert.throws(() => parseAcademicPlan("Not JSON",5), /usable title/);
assert.throws(() => academicPlanFromDocument("An old continuous essay",5), /no structured academic outline/);
console.log("PASS: dissertations have five chapters; master's theses have four; title, matching contents, final references, chapter-by-chapter generation, resume, invalid-structure rejection and rendered headings/contents links passed. No provider calls made.");
