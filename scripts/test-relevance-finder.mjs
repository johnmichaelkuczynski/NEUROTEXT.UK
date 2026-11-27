import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
const { build } = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url))("esbuild");
const out = new URL(`../artifacts/api-server/dist/finder-unit-${randomUUID()}.mjs`, import.meta.url);
try {
  await build({ stdin: { contents: 'export * from "./src/services/relevance-finder.ts"; export { getAnthropic } from "@workspace/integrations-anthropic-ai";', resolveDir: new URL("../artifacts/api-server/", import.meta.url).pathname },
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
  const catalog = f.rewriteEvidence(rendered, source);
  assert.equal(catalog.length, 1);
  const referenced = f.materializeRewrite(JSON.stringify({ paragraphs: [{
    text: draft + " The supplied source (Box B) explains: [[S1]]", evidenceIds: ["S1"],
  }] }), catalog);
  const referencedText = f.validateRewrite(referenced, draft, source, draft);
  assert(referencedText.includes("“Direct awareness is not an inference from prior beliefs.”"));
  assert(!referencedText.includes("[[S1]]"));
  assert.throws(() => f.materializeRewrite(JSON.stringify({ paragraphs: [{
    text: "A forged source: [[S99]]", evidenceIds: ["S99"],
  }] }), catalog), /verified|supplied/i);
  assert.throws(() => f.materializeRewrite(JSON.stringify({ paragraphs: [{
    text: "An unsupported statement.", evidenceIds: ["S99"],
  }] }), catalog), /supplied/i);
  const credited = JSON.parse(f.materializeRewrite(JSON.stringify({ paragraphs: [{
    text: draft + " [[S1]]", evidenceIds: ["S1"],
  }] }), catalog));
  assert(credited.text.includes("Source: Box B"));
  assert(f.validateRewrite(JSON.stringify(credited), draft, source, draft));
  const nestedSource = 'The text describes “distributed knowledge” as socially shared understanding.';
  const nestedReport = `• Source (Box B): “${nestedSource}”`;
  assert.equal(f.rewriteEvidence(nestedReport, nestedSource)[0]?.quotation, nestedSource, "Nested quotation marks must not truncate source evidence");
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
  const mixed = JSON.parse(report);
  mixed.points.push({ ...mixed.points[0], connection: "UNSUPPORTED CLAIM MUST NOT APPEAR", materialQuote: "This was never in the source." });
  const partial = f.renderFinderReport(JSON.stringify(mixed), draft, source);
  assert(partial.includes("How to use it:"));
  assert(partial.includes("omitted"));
  assert(!partial.includes("UNSUPPORTED CLAIM"));
  const typographyReport = JSON.parse(report);
  typographyReport.points[0].materialQuote = "The source's distinction—direct knowledge.";
  const typography = f.renderFinderReport(JSON.stringify(typographyReport), draft, "The source’s distinction–direct knowledge.");
  assert(typography.includes("The source’s distinction–direct knowledge."), "Display the document's original punctuation");
  let corrections = 0;
  const correctedReport = await f.generateFinderReport(input, async (_system, prompt, consume) => {
    corrections++;
    const p = JSON.parse(prompt);
    if (corrections === 2) assert(p.correctionRequired.includes("quotation") && p.previousAnswer);
    consume(corrections === 1 ? report.replace("Direct awareness is not an inference", "A paraphrase that is not a quotation") : report);
  }, () => {}, () => false);
  assert.equal(corrections, 2);
  assert(correctedReport.includes("How to use it:"));
  let partialCalls = 0;
  const preserved = await f.generateFinderReport(input, async (_system, _prompt, consume) => {
    partialCalls++;
    consume(JSON.stringify(mixed));
  }, () => {}, () => false);
  assert.equal(partialCalls, 2);
  assert(preserved.includes("How to use it:") && preserved.includes("omitted"));
  assert(!preserved.includes("UNSUPPORTED CLAIM"));
  await assert.rejects(() => f.generateFinderReport(input, async (_system, _prompt, consume) => {
    consume(report.replace("Direct awareness is not an inference", "Fabricated source evidence"));
  }, () => {}, () => false), /automatic correction/i);
  const proof = f.reportProof(input, rendered, "owner");
  assert(f.validReportProof(input, rendered, proof, "owner"));
  assert(f.validReportProof({ ...input, rewriteInstructions: "Expand objections and preserve my voice." }, rendered, proof, "owner"), "Rewrite-only directions must not invalidate the report");
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
    async (_system, prompt, consume) => { segments++; consume(JSON.parse(prompt).segmentToRewrite); },
    text => { rewritten += text; }, () => {}, () => false);
  assert(segments > 1);
  assert(rewritten.startsWith("Knowledge"));
  assert(rewritten.endsWith("Final distinctive original conclusion."));
  assert.equal(rewritten.match(/First argument/g).length, 600);
  const attributed = 'The supplied source (Box B) states: “Direct awareness is not an inference from prior beliefs.”';
  assert.throws(() => f.validateRewrite(JSON.stringify({ text: attributed + ' “This quotation was never in either document.”',
    sourceUses: [{ passage: attributed, sourceQuote: "Direct awareness is not an inference from prior beliefs.", sourceLabel: "Box B" }] }), draft, source, draft), /unverified/i);
  assert.throws(() => f.validateRewrite(JSON.stringify({ text: draft + " More source-derived material." }), draft, source, draft), /attribute/i);
  const longerQuote = 'As the supplied source (Box B) explains: “Direct awareness is not an inference from prior beliefs. Inferential knowledge instead depends on other propositions.”';
  assert.equal(f.validateRewrite(JSON.stringify({ text: longerQuote, sourceUses: [{
    passage: longerQuote, sourceQuote: "Direct awareness is not an inference from prior beliefs.", sourceLabel: "Box B",
  }] }), draft, source, draft), longerQuote, "Evidence nested within a longer quotation is valid");
  const commaQuote = longerQuote.replace('propositions.”', 'propositions,”');
  assert.equal(f.validateRewrite(JSON.stringify({ text: commaQuote, sourceUses: [{
    passage: commaQuote, sourceQuote: "Direct awareness is not an inference from prior beliefs.", sourceLabel: "Box B",
  }] }), draft, source, draft), commaQuote, "Editorial terminal punctuation does not invent quoted words");
  const attributedParagraph = 'The supplied source (Box B) distinguishes epistemic relations. Direct awareness can provide a basis distinct from propositional inference.';
  assert.equal(f.validateRewrite(JSON.stringify({ text: attributedParagraph, sourceUses: [{
    passage: "Direct awareness can provide a basis distinct from propositional inference.",
    sourceQuote: "Direct awareness is not an inference from prior beliefs.", sourceLabel: "the supplied source (Box B)",
  }] }), draft, source, draft), attributedParagraph, "Attribution in the preceding sentence of the paragraph is valid");
  const formattedBorrowing = f.validateRewrite(JSON.stringify({ text: "The supplied source (Box B) explains: Direct awareness is not an inference from prior beliefs.",
    sourceUses: [{ passage: "Direct awareness is not an inference from prior beliefs.", sourceQuote: "Direct awareness is not an inference from prior beliefs.", sourceLabel: "Box B" }],
  }), draft, source, draft);
  assert(formattedBorrowing.includes("“Direct awareness is not an inference from prior beliefs.”"), "Verified borrowing is automatically enclosed in quotation marks");
  assert.throws(() => f.validateRewrite(JSON.stringify({ text: "Direct awareness can provide a basis distinct from propositional inference.",
    sourceUses: [{ passage: "Direct awareness can provide a basis distinct from propositional inference.", sourceQuote: "Direct awareness is not an inference from prior beliefs.", sourceLabel: "Box B" }],
  }), draft, source, draft), /in-text source attribution/i, "Metadata cannot replace in-text credit");
  let rewriteAttempts = 0, correctedRewrite = "", providerReturned = false;
  await f.rewriteWithFindings({ ...input, rewriteInstructions: "Expand objections and preserve my voice." }, rendered, async (_system, prompt, consume) => {
    rewriteAttempts++;
    assert(JSON.parse(prompt).relevanceReport);
    assert.equal(JSON.parse(prompt).rewriteInstructions, "Expand objections and preserve my voice.");
    consume("A working draft with ");
    assert.equal(correctedRewrite, "A working draft with ", "Words must reach the user before the model call completes");
    consume('“wording requiring author review.”');
    providerReturned = true;
  }, value => { assert(!providerReturned); correctedRewrite += value; }, () => {}, () => false);
  assert.equal(rewriteAttempts, 1, "Quality checks must not trigger another generation or withhold the user's draft");
  assert.equal(correctedRewrite, 'A working draft with “wording requiring author review.”');
  let oldReportRewrite = "";
  await f.rewriteWithFindings(input, "An older report without structured source quotes.", async (_system, _prompt, consume) => {
    consume("A useful attributed paraphrase for review.");
  }, value => { oldReportRewrite += value; }, () => {}, () => false);
  assert(oldReportRewrite.includes("useful"), "Report formatting must not block a rewrite");
  console.log("PASS: report evidence checks, owner/input-bound proofs, long-source coverage, segmented rewrite preservation, immediate token delivery and non-blocking rewrite quality checks.");
  if (process.argv.includes("--live") || process.argv.includes("--saved") || process.argv.includes("--saved-rewrite")) {
    const OpenAI = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url))("openai").default;
    const client = new OpenAI({ apiKey: process.env.PERPLEXITY_API_KEY, baseURL: "https://api.perplexity.ai", timeout: 90000, maxRetries: 0 });
    const liveGenerate = async (system, prompt, consume, maxTokens) => {
      if (process.argv.includes("--anthropic")) {
        const result = await f.getAnthropic().messages.create({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
          max_tokens: maxTokens || 8192, system, messages: [{ role: "user", content: prompt }],
        });
        consume(result.content.filter(block => block.type === "text").map(block => block.text).join(""));
        return;
      }
      const result = await client.chat.completions.create({ model: "sonar-pro", messages: [{ role: "system", content: system }, { role: "user", content: prompt }], max_tokens: Math.min(maxTokens, 5000), temperature: 0.2 });
      consume(result.choices[0]?.message?.content || "");
    };
    let liveData = { ...input, instructionDraft: draft + " My paper must explain how a belief can have an epistemic basis without being inferred from a premise. It must also distinguish causal dependence among events from logical dependence among propositions.",
      sourceDocument: source + " Causal dependence holds among events or states. A perceptual belief can depend causally on an object and sensory processes without being inferred from a proposition describing those processes. Causal connection alone does not guarantee knowledge: perception can mislead. Reliability is a separate question from whether a person reasons from premises. These distinctions identify different problems; they do not by themselves refute skepticism." };
    let savedReport = "";
    if (process.argv.includes("--saved") || process.argv.includes("--saved-rewrite")) {
      let saved;
      if (process.argv.includes("--latest-saved")) {
        const { Pool } = createRequire(new URL("../lib/db/package.json", import.meta.url))("pg");
        const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: "-c default_transaction_read_only=on" });
        try {
          const { rows } = await pool.query("SELECT payload FROM neurotext_workspaces WHERE function_id=$1 AND session_id LIKE 'user:%' AND coalesce(payload->>'relevanceReport','')<>'' ORDER BY updated_at DESC LIMIT 1", [14]);
          saved = rows[0]?.payload;
          assert(saved && !["writing", "preparing"].includes(saved.status), "Do not test while the saved run is active");
        } finally { await pool.end(); }
      } else {
        const response = await fetch(`https://${process.env.REPLIT_DEV_DOMAIN}/api/functions/workspaces/14`);
        assert(response.ok);
        saved = await response.json();
      }
      assert(saved.instructionDraft && saved.sourceDocument);
      liveData = { instructionDraft: saved.instructionDraft, sourceDocument: saved.sourceDocument, instructions: saved.instructions || "" };
      savedReport = saved.relevanceReport || saved.output || "";
    }
    const liveReport = process.argv.includes("--saved-rewrite") ? savedReport : await f.generateFinderReport(liveData, liveGenerate, () => {}, () => false);
    assert(liveReport.trim());
    if (process.argv.includes("--saved")) {
      assert(liveReport.includes("How to use it:"));
      console.log(`SAVED DOCUMENTS PASS: report generated from the saved draft and all ${f.documentChunks(liveData.sourceDocument, 16000, 95000).length} source sections; ${[...liveReport.matchAll(/How to use it:/g)].length} connections with checked quotations. Saved workspace was not modified.`);
    } else {
    let liveRewrite = "";
    await f.rewriteWithFindings(liveData, liveReport, liveGenerate, text => { liveRewrite += text; }, () => {}, () => false);
    assert(liveRewrite.trim());
    console.log("LIVE PROVIDER PASS: a nonempty working rewrite was delivered without quotation-verification gates.");
    if (process.argv.includes("--saved-rewrite")) {
      const outputDir = new URL("../.local/verification/", import.meta.url);
      await mkdir(outputDir, { recursive: true });
      const providerName = process.argv.includes("--anthropic") ? "anthropic" : "perplexity";
      await writeFile(new URL(`relevance-rewrite-${providerName}${process.argv.includes("--latest-saved") ? "-latest" : ""}.txt`, outputDir), liveRewrite);
      console.log(`SAVED REWRITE PASS (${providerName}): ${liveRewrite.length} characters; original draft and saved report were not modified.`);
    } else console.log("REPORT:\n" + liveReport + "\nREWRITTEN DRAFT:\n" + liveRewrite);
    }
  }
} finally { await rm(out, { force: true }); }
