import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
const { build } = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url))("esbuild");
const out = new URL(`../artifacts/api-server/dist/finder-unit-${randomUUID()}.mjs`, import.meta.url);
try {
  await build({ stdin: { contents: 'export * from "./src/services/relevance-finder.ts"', resolveDir: new URL("../artifacts/api-server/", import.meta.url).pathname },
    bundle: true, platform: "node", format: "esm", outfile: out.pathname, logLevel: "silent" });
  const f = await import(out.href);
  const draft = "Knowledge need not always depend on inference. Perception may supply knowledge directly.";
  const source = "=== Book.txt ===\nDirect awareness is not an inference from prior beliefs. Inferential knowledge instead depends on other propositions.";
  const report = JSON.stringify({ summary: "The source sharpens the draft’s distinction between direct and inferential knowledge.", points: [{
    connection: "It distinguishes direct awareness from inference.", draftQuote: "Knowledge need not always depend on inference.",
    materialQuote: "Direct awareness is not an inference from prior beliefs.", sourceLabel: "Book.txt", application: "Use the distinction to specify what direct knowledge excludes.",
  }] });
  const rendered = f.renderFinderReport(report, draft, source);
  assert(rendered.includes("How to use it:"));
  assert.throws(() => f.renderFinderReport(report.replace("Direct awareness is not an inference", "A completely invented passage"), draft, source), /quotation/i);
  for (const sourceLabel of ["Missing book", "box b", "", null, 42, "x".repeat(251), undefined]) {
    const value = JSON.parse(report);
    value.points[0].sourceLabel = sourceLabel;
    const corrected = f.renderFinderReport(JSON.stringify(value), draft, source);
    assert(corrected.includes("Source (Box B):"), "Unverified metadata must use the actual input label, not discard verified findings");
    assert(!corrected.includes("Missing book"));
  }
  const noTitleSource = source.replace("=== Book.txt ===\n", "");
  assert(f.renderFinderReport(report, draft, noTitleSource).includes("Source (Box B):"), "Pasted text need not contain a title");
  assert.throws(() => f.renderFinderReport(report.replace("Knowledge need not always depend on inference.", "An invented draft quotation."), draft, source), /quotation/i);
  const input = { instructionDraft: draft, sourceDocument: source, instructions: "Focus on logical dependence." };
  const proof = f.reportProof(input, rendered, "owner");
  assert(f.validReportProof(input, rendered, proof, "owner"));
  for (const key of ["instructions", "instructionDraft", "sourceDocument"]) assert(!f.validReportProof({ ...input, [key]: input[key] + " changed" }, rendered, proof, "owner"));
  assert(!f.validReportProof(input, rendered + " forged", proof, "owner"));
  assert(!f.validReportProof(input, rendered, proof, "other-user"));
  assert.equal(f.finderSourceError("word ".repeat(200000)), null);
  assert(f.finderSourceError("word ".repeat(200001)));
  assert(f.finderSourceError("x".repeat(1200001)));
  assert.throws(() => f.documentChunks("x".repeat(10001), 1000, 9000), /uninterrupted/i);
  const late = "The final section explains direct knowledge without inference.";
  const longSource = "unrelated ".repeat(20000) + "\n\n" + late;
  let calls = 0;
  const generate = async (_system, prompt, consume) => {
    calls++;
    const p = JSON.parse(prompt);
    const relevant = (p.relevantText || JSON.stringify(p.verifiedSectionReports)).includes(late);
    consume(JSON.stringify({ summary: relevant ? "The source bears on direct knowledge." : "This section contains no supported connection.",
      points: relevant ? [{ connection: "The final section clarifies direct knowledge.", draftQuote: "Knowledge need not always depend on inference.", materialQuote: late, sourceLabel: "Box B", application: "Use it to clarify the direct/inferential distinction." }] : [] }));
  };
  const whole = await f.generateFinderReport({ ...input, sourceDocument: longSource }, generate, () => {}, () => false);
  assert(whole.includes(late), "Relevant material near the end of a long source must not be skipped");
  assert(calls >= 3);
  let labelCalls = 0;
  const recovered = await f.generateFinderReport(input, async (_system, _prompt, consume) => {
    labelCalls++;
    consume(report.replace("Book.txt", "A descriptive title not embedded in the source"));
  }, () => {}, () => false);
  assert.equal(labelCalls, 1, "Source-label recovery must not require another paid model call");
  assert(recovered.includes("Source (Box B):"));
  const recoveredProof = f.reportProof(input, recovered, "owner");
  assert(f.validReportProof(input, recovered, recoveredProof, "owner"));
  const consolidated = await f.generateFinderReport({ ...input, sourceDocument: longSource }, async (_system, prompt, consume) => {
    const p = JSON.parse(prompt);
    const relevant = (p.relevantText || JSON.stringify(p.verifiedSectionReports)).includes(late);
    consume(JSON.stringify({ summary: "Section findings.", points: relevant ? [{
      connection: "Clarifies direct knowledge.", draftQuote: "Knowledge need not always depend on inference.",
      materialQuote: late, sourceLabel: "Unverified book title", application: "Clarify the distinction.",
    }] : [] }));
  }, () => {}, () => false);
  assert(consolidated.includes(late));
  assert(consolidated.includes("Source (Box B):"));
  assert(!consolidated.includes("Unverified book title"));
  let rewritten = "", segments = 0;
  const original = draft + "\n\n" + "First argument establishes the distinction. ".repeat(600) + "\n\nFinal distinctive original conclusion.";
  await f.rewriteWithFindings({ ...input, instructionDraft: original }, rendered,
    async (_system, prompt, consume) => { segments++; consume(JSON.stringify({ text: JSON.parse(prompt).segmentToRewrite })); },
    text => { rewritten += text; }, () => {}, () => false);
  assert(segments > 1);
  assert(rewritten.startsWith("Knowledge"));
  assert(rewritten.endsWith("Final distinctive original conclusion."));
  assert.equal(rewritten.match(/First argument/g).length, 600);
  const attributed = 'The supplied source (Box B) states: “Direct awareness is not an inference from prior beliefs.”';
  assert.throws(() => f.validateRewrite(JSON.stringify({ text: attributed + ' “This quotation was never in either document.”',
    sourceUses: [{ passage: attributed, sourceQuote: "Direct awareness is not an inference from prior beliefs.", sourceLabel: "Box B" }] }), draft, source, draft), /unverified/i);
  assert.throws(() => f.validateRewrite(JSON.stringify({ text: draft + " More source-derived material." }), draft, source, draft), /attribute/i);
  console.log("PASS: exact quotations, source labels, owner/input-bound report proofs, long-source limits and late-section coverage, segmented rewrite coverage and invented-quotation rejection.");
  if (process.argv.includes("--live")) {
    const OpenAI = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url))("openai").default;
    const client = new OpenAI({ apiKey: process.env.PERPLEXITY_API_KEY, baseURL: "https://api.perplexity.ai", timeout: 90000, maxRetries: 0 });
    const liveGenerate = async (system, prompt, consume, maxTokens) => {
      const result = await client.chat.completions.create({ model: "sonar-pro", messages: [{ role: "system", content: system }, { role: "user", content: prompt }], max_tokens: Math.min(maxTokens, 5000), temperature: 0.2 });
      consume(result.choices[0]?.message?.content || "");
    };
    const liveData = { ...input, instructionDraft: draft + " My paper must explain how a belief can have an epistemic basis without being inferred from a premise. It must also distinguish causal dependence among events from logical dependence among propositions.",
      sourceDocument: source + " Causal dependence holds among events or states. A perceptual belief can depend causally on an object and sensory processes without being inferred from a proposition describing those processes. Causal connection alone does not guarantee knowledge: perception can mislead. Reliability is a separate question from whether a person reasons from premises. These distinctions identify different problems; they do not by themselves refute skepticism." };
    const liveReport = await f.generateFinderReport(liveData, liveGenerate, () => {}, () => false);
    let liveRewrite = "";
    await f.rewriteWithFindings(liveData, liveReport, liveGenerate, text => { liveRewrite += text; }, () => {}, () => false);
    assert(liveRewrite.trim());
    console.log("LIVE DEFAULT PROVIDER PASS: report and rewrite returned valid structured output; quotations matched the supplied texts.");
    console.log("REPORT:\n" + liveReport + "\nREWRITTEN DRAFT:\n" + liveRewrite);
  }
} finally { await rm(out, { force: true }); }
