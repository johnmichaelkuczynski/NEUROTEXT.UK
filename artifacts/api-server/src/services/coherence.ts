import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { generateWithFallback, generateWithFallbackStreaming } from "./llm-router";

export const ANTI_SYCOPHANCY_CLAUSES = `- Preserve every REJECTS entry verbatim. Do not soften, qualify, or convert a REJECTS into an OPEN.
- Preserve every numerical value, date, proper name, citation, and quoted phrase exactly as it appears.
- If two entries contradict, do not silently merge them. Emit a CONFLICT_FLAG entry that quotes both.
- Defeats, negative results, and counterexamples are load-bearing. Preserve them anyway.
- You are not being graded on smoothness, harmony, or readability. You are being graded on whether the tier you emit can be used to detect a hallucination two chunks from now.`;

export const COHERENCE_MODES = [
  "autodetect",
  "logical",
  "mathematical",
  "persuasive",
  "scientific",
  "philosophical",
  "structural",
  "narrative",
  "legal",
  "technical",
] as const;

type CoherenceMode = (typeof COHERENCE_MODES)[number];

type CoherenceDimension = {
  label: string;
  score: number;
  note: string;
};

export type CoherenceScorecard = {
  mode: string;
  score: number | null;
  verdict: string;
  dimensions: CoherenceDimension[];
};

export type CoherenceProviderUsage = {
  evidence: string[];
  skeleton: string[];
  audit: string[];
};

const modeTitles: Record<CoherenceMode, string> = {
  autodetect: "Autodetect",
  logical: "Logical",
  mathematical: "Mathematical",
  persuasive: "Persuasive",
  scientific: "Scientific",
  philosophical: "Philosophical",
  structural: "Structural",
  narrative: "Narrative",
  legal: "Legal",
  technical: "Technical",
};

const modeRubrics: Record<CoherenceMode, string> = {
  autodetect: "First identify the document's dominant reasoning task, then apply the most suitable lens. Say which lens you selected in the MODE line.",
  logical: "Test premise-to-conclusion validity, contradiction, equivocation, hidden assumptions, and scope shifts.",
  mathematical: "Test definitions, notation stability, dependencies between claims, proof steps, quantifiers, and inferential validity. Do not assess unprovided calculations.",
  persuasive: "Test audience fit, claim support, counterargument handling, warrants, evidence relevance, and rhetorical transitions.",
  scientific: "Test hypothesis-method-evidence alignment, causal claims, operational definitions, uncertainty, alternative explanations, and conclusion scope.",
  philosophical: "Test conceptual distinctions, premise support, category errors, competing commitments, implication chains, and treatment of objections.",
  structural: "Test thesis prominence, section order, hierarchy, sequencing, transitions, and whether each part advances the document's governing purpose.",
  narrative: "Test chronology, point of view, character motivation, causal progression, stakes, and continuity of setting or established facts.",
  legal: "Test issue-rule-application-conclusion structure, authority handling, factual consistency, burdens, remedies, and unresolved legal inferences.",
  technical: "Test requirements traceability, terminology, prerequisites, procedure order, dependencies, exceptions, and implementation ambiguity.",
};

let schemaReady: Promise<void> | undefined;

function ensureSchema() {
  schemaReady ??= (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS neurotext_coherence_jobs (
        id UUID PRIMARY KEY,
        title TEXT NOT NULL,
        original_text TEXT NOT NULL,
        instructions TEXT,
        provider TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        global_skeleton JSONB,
        final_output TEXT,
        coherence_score NUMERIC,
        coherence_report JSONB,
        provider_used TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS neurotext_coherence_chunks (
        id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES neurotext_coherence_jobs(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        input_text TEXT NOT NULL,
        output_text TEXT,
        delta JSONB,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS neurotext_tractatus_tiers (
        id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES neurotext_coherence_jobs(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL,
        tier INTEGER NOT NULL,
        tree JSONB NOT NULL,
        node_count INTEGER NOT NULL DEFAULT 0,
        parent_tier_id UUID,
        compression_count INTEGER NOT NULL DEFAULT 0,
        last_update TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS neurotext_tractatus_archive (
        id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES neurotext_coherence_jobs(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL,
        tier INTEGER NOT NULL,
        tree_snapshot JSONB NOT NULL,
        node_count_at_snapshot INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
      await pool.query(`
        ALTER TABLE neurotext_coherence_jobs
          ADD COLUMN IF NOT EXISTS coherence_report JSONB,
          ADD COLUMN IF NOT EXISTS provider_used TEXT
      `);
  })();
  return schemaReady;
}

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

function parseTargetWords(value?: string) {
  if (!value?.trim()) return null;
  const parsed = Number(value.replace(/,/g, "").trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) return null;
  return parsed;
}

function trimToExactWords(text: string, targetWords: number) {
  const matches = [...text.matchAll(/\S+/g)];
  if (matches.length <= targetWords) return text.trim();
  const finalWord = matches[targetWords - 1];
  return text.slice(0, (finalWord.index ?? 0) + finalWord[0].length).trim();
}

function splitParagraphs(text: string, maxWords = 500) {
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (countWords(candidate) > maxWords && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

function skeletonToTree(skeleton: string) {
  return {
    "1.0": `ASSERTS: ${skeleton.slice(0, 1500)}`,
  };
}

function resolveMode(mode: string): CoherenceMode {
  return (COHERENCE_MODES as readonly string[]).includes(mode)
    ? mode as CoherenceMode
    : "autodetect";
}

function parseScorecard(output: string, mode: CoherenceMode): CoherenceScorecard {
  const scoreMatch = output.match(/OVERALL\s+SCORE\s*:\s*(\d{1,3})\s*(?:\/\s*100)?/i);
  const verdictMatch = output.match(/VERDICT\s*:\s*([^\n]+)/i);
  const modeMatch = output.match(/^MODE\s*:\s*([^\n]+)/im);
  const lines = output.split(/\r?\n/);
  const dimensions: CoherenceDimension[] = [];
  let readingDimensions = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^DIMENSIONS\s*:\s*$/i.test(line)) {
      readingDimensions = true;
      continue;
    }
    if (readingDimensions && /^[A-Z][A-Z /&-]{2,}:\s*$/.test(line)) break;
    if (!readingDimensions) continue;
    const match = line.match(/^(?:[-•]\s*)?(.+?)\s*:\s*(\d{1,3})\s*(?:\/\s*100)?\s*[—–-]\s*(.+)$/);
    if (!match) continue;
    dimensions.push({
      label: match[1].trim(),
      score: Math.max(0, Math.min(100, Number(match[2]))),
      note: match[3].trim(),
    });
  }

  const explicitScore = scoreMatch ? Math.max(0, Math.min(100, Number(scoreMatch[1]))) : null;
  const dimensionAverage = dimensions.length
    ? Math.round(dimensions.reduce((total, item) => total + item.score, 0) / dimensions.length)
    : null;

  return {
    mode: modeMatch?.[1]?.trim() || modeTitles[mode],
    score: explicitScore ?? dimensionAverage,
    verdict: verdictMatch?.[1]?.trim() || "The evaluator did not return a concise verdict.",
    dimensions,
  };
}

export async function runCoherenceJob(input: {
  title: string;
  text: string;
  instructions?: string;
  targetWords?: string;
  provider: string;
  mode: string;
  allowFallback?: boolean;
  thinker?: string;
  quotes?: number;
}, hooks?: {
  onSkeleton?: (text: string, providerUsed: string) => Promise<void> | void;
  onSkeletonToken?: (text: string, providerUsed: string) => Promise<void> | void;
  onEvidenceToken?: (text: string, index: number, total: number, providerUsed: string) => Promise<void> | void;
  onAuditToken?: (text: string, providerUsed: string) => Promise<void> | void;
  onReplaceOutput?: (text: string) => Promise<void> | void;
}) {
  await ensureSchema();
  const jobId = randomUUID();
  const chunks = splitParagraphs(input.text);

  await pool.query(
    `INSERT INTO neurotext_coherence_jobs (id, title, original_text, instructions, provider, mode, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'skeleton_extraction')`,
    [jobId, input.title, input.text, input.instructions ?? "", input.provider, input.mode],
  );
  for (const [index, chunk] of chunks.entries()) {
    await pool.query(
      `INSERT INTO neurotext_coherence_chunks (id, job_id, chunk_index, input_text) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), jobId, index, chunk],
    );
  }

  const mode = resolveMode(input.mode);
  const thinkerContext = input.thinker
    ? `Use the intellectual perspective of ${input.thinker} when interpreting the document. ${
        input.quotes && input.quotes > 0
          ? `Aim to include exactly ${input.quotes} accurate, clearly attributed quotations from ${input.thinker} when relevant and supplied by the knowledge source. If fewer can be supported, use only the verified quotations.`
          : "Do not include direct quotations from the thinker."
      } Never invent quotations or falsely attribute claims.`
    : "Use a neutral scholarly perspective.";
  const generationOptions = { quotes: input.quotes, allowFallback: input.allowFallback };
  const useHierarchicalEvidence = input.text.length > 50000;
  const chunkEvidence: string[] = [];
  const evidenceProviders = new Set<string>();
  if (useHierarchicalEvidence) {
    for (const [index, chunk] of chunks.entries()) {
      const evidencePrompt = `Extract compact coherence evidence from chunk ${index + 1} of ${chunks.length}. Preserve only claims, definitions, assumptions, objections, causal or inferential links, changes in terminology, and exact source anchors needed to audit the full document. Do not summarize prose or rewrite the chunk. Return at most 140 words of plain text.

${ANTI_SYCOPHANCY_CLAUSES}

CHUNK ${index + 1}:
${chunk}`;
      const evidence = hooks?.onEvidenceToken
        ? await generateWithFallbackStreaming(
            input.provider,
            evidencePrompt,
            (token, providerUsed) => {
              evidenceProviders.add(providerUsed);
              return hooks.onEvidenceToken?.(token, index, chunks.length, providerUsed);
            },
            { ...generationOptions, maxWords: 140 },
          )
        : await generateWithFallback(input.provider, evidencePrompt, { ...generationOptions, maxWords: 140 });
      evidenceProviders.add(evidence.providerUsed);
      chunkEvidence.push(`CHUNK ${index + 1}: ${evidence.text}`);
      await pool.query(
        `UPDATE neurotext_coherence_chunks
         SET output_text = $3, delta = $4::jsonb, status = 'evidence_complete'
         WHERE job_id = $1 AND chunk_index = $2`,
        [jobId, index, evidence.text, JSON.stringify({ wordCount: countWords(chunk), evidence: evidence.text })],
      );
      await pool.query(
        `INSERT INTO neurotext_tractatus_tiers (id, job_id, job_type, tier, tree, node_count)
         VALUES ($1, $2, 'coherence', 1, $3::jsonb, 1)`,
        [randomUUID(), jobId, JSON.stringify({ [`1.${index + 1}`]: evidence.text })],
      );
    }
  }
  let reducedEvidence = chunkEvidence;
  let reductionTier = 2;
  while (reducedEvidence.join("\n\n").length > 45000) {
    const nextLevel: string[] = [];
    for (let index = 0; index < reducedEvidence.length; index += 20) {
      const group = reducedEvidence.slice(index, index + 20);
      const condensed = await generateWithFallback(
        input.provider,
        `Consolidate this full-document coherence evidence into a compact audit index. Preserve every named claim, conflict, definition change, and source anchor that could affect a final coherence score. Do not write a summary or introduce new claims. Return at most 800 words.\n\n${group.join("\n\n")}`,
        { ...generationOptions, maxWords: 800 },
      );
      evidenceProviders.add(condensed.providerUsed);
      nextLevel.push(`EVIDENCE GROUP ${Math.floor(index / 20) + 1}: ${condensed.text}`);
      await pool.query(
        `INSERT INTO neurotext_tractatus_tiers (id, job_id, job_type, tier, tree, node_count)
         VALUES ($1, $2, 'coherence', $3, $4::jsonb, 1)`,
        [randomUUID(), jobId, reductionTier, JSON.stringify({ [`${reductionTier}.${Math.floor(index / 20) + 1}`]: condensed.text })],
      );
    }
    reducedEvidence = nextLevel;
    reductionTier += 1;
  }
  const sourceBasis = useHierarchicalEvidence
    ? `FULL-DOCUMENT HIERARCHICAL EVIDENCE. Every source chunk was examined; this bounded evidence index represents the complete document.\n${reducedEvidence.join("\n\n")}`
    : input.text;
  const skeletonPrompt = `Extract a compact document skeleton. Include: THESIS, OUTLINE, KEY TERMS with definitions, ASSERTS, REJECTS, ASSUMES, and ENTITIES. Do not rewrite the document. Return concise plain text.\n${thinkerContext}\n\nDOCUMENT OR FULL-DOCUMENT EVIDENCE:\n${sourceBasis}`;
  const skeletonResponse = hooks?.onSkeletonToken
    ? await generateWithFallbackStreaming(
        input.provider,
        skeletonPrompt,
        (token, providerUsed) => hooks.onSkeletonToken?.(token, providerUsed),
        generationOptions,
      )
    : await generateWithFallback(input.provider, skeletonPrompt, generationOptions);
  await hooks?.onSkeleton?.(skeletonResponse.text, skeletonResponse.providerUsed);
  await pool.query(
    `UPDATE neurotext_coherence_jobs SET global_skeleton = $2::jsonb, status = 'chunk_processing', updated_at = NOW() WHERE id = $1`,
    [jobId, JSON.stringify({ text: skeletonResponse.text })],
  );
  await pool.query(
    `INSERT INTO neurotext_tractatus_tiers (id, job_id, job_type, tier, tree, node_count)
     VALUES ($1, $2, 'coherence', 0, $3::jsonb, 1)`,
    [randomUUID(), jobId, JSON.stringify(skeletonToTree(skeletonResponse.text))],
  );

  const requestedTargetWords = parseTargetWords(input.targetWords);
  const openingTargetWords = requestedTargetWords ? Math.min(1200, requestedTargetWords) : 1200;
  const auditPrompt = `You are the NEUROTEXT Coherence Evaluator. Produce an evidence-led coherence audit, not a summary, paraphrase, rewrite, or chunk-by-chunk restatement.

SELECTED COHERENCE MODE: ${modeTitles[mode]}
MODE RUBRIC: ${modeRubrics[mode]}
USER INSTRUCTIONS: ${input.instructions || "Use the selected mode and evaluate only what the supplied document supports."}
INTELLECTUAL PERSPECTIVE: ${thinkerContext}

DOCUMENT SKELETON (supporting reference only):
${skeletonResponse.text.slice(0, 12000)}

${ANTI_SYCOPHANCY_CLAUSES}

Return plain text in EXACTLY this order. Use no Markdown heading syntax. ${requestedTargetWords
  ? `The user requested an EXACTLY ${requestedTargetWords.toLocaleString()}-word coherence report. This opening section should contain approximately ${openingTargetWords.toLocaleString()} words and establish the scorecard and highest-priority findings; further evidence sections will follow until the exact total is reached.`
  : "Keep the whole audit under 1,200 words."}
OVERALL SCORE: [integer from 0 to 100]/100
VERDICT: [one direct sentence]
MODE: [the selected mode, or in Autodetect the selected mode plus the detected primary lens]
DIMENSIONS:
- [dimension]: [integer]/100 — [specific explanation]
- [dimension]: [integer]/100 — [specific explanation]
- [dimension]: [integer]/100 — [specific explanation]
- [dimension]: [integer]/100 — [specific explanation]
STRENGTHS:
- [up to 3 specific strengths]
CRITICAL BREAKS:
1. [High/Medium/Low] Location: [short exact quote, heading, or paragraph cue] | Problem: [specific coherence failure] | Why it matters: [mode-specific consequence] | Repair: [concrete repair]
REPAIRS:
1. [up to 5 prioritized, actionable repairs]

Rules: The score must follow from the four dimension scores. Identify no more than five critical breaks. If a requested kind of defect is absent, say so rather than inventing one. Do not copy source paragraphs, give a general summary, append a rewritten article, or invent quotations, locations, facts, citations, or calculations.

SOURCE DOCUMENT OR FULL-DOCUMENT EVIDENCE:
${sourceBasis}`;
  const auditResponse = hooks?.onAuditToken
    ? await generateWithFallbackStreaming(
        input.provider,
        auditPrompt,
        (token, providerUsed) => hooks.onAuditToken?.(token, providerUsed),
        { ...generationOptions, maxWords: openingTargetWords + 120, paceMs: requestedTargetWords && requestedTargetWords > 1200 ? 2 : 18 },
      )
    : await generateWithFallback(input.provider, auditPrompt, { ...generationOptions, maxWords: openingTargetWords + 120 });
  let output = auditResponse.text.trim();
  const auditProviders = new Set([auditResponse.providerUsed]);
  let continuationIndex = 1;
  while (requestedTargetWords && countWords(output) < requestedTargetWords) {
    if (continuationIndex > 200) throw new Error(`The coherence report could not reach exactly ${requestedTargetWords} words.`);
    const writtenWords = countWords(output);
    const remainingWords = requestedTargetWords - writtenWords;
    const sectionTargetWords = Math.min(1000, remainingWords);
    const continuationPrompt = `Continue the same NEUROTEXT coherence report.

EXACT TOTAL REQUIRED: ${requestedTargetWords} words.
WORDS ALREADY WRITTEN: ${writtenWords}.
WORDS REMAINING: ${remainingWords}.
TARGET FOR THIS CONTINUATION: approximately ${sectionTargetWords} words.

Deepen the evidence-led analysis with additional source-anchored findings, cross-section connections, contradiction analysis, transition analysis, terminology tracking, structural consequences, and concrete repairs. Do not restart the report, repeat the scorecard headings, summarize prior prose, rewrite the source document, invent defects, or discuss this instruction. Continue directly from the existing report. When approaching the final total, end with complete actionable repair analysis.

DOCUMENT SKELETON:
${skeletonResponse.text.slice(0, 12000)}

TAIL OF REPORT ALREADY WRITTEN:
${output.slice(-12000)}

SOURCE DOCUMENT OR FULL-DOCUMENT EVIDENCE:
${sourceBasis.slice(0, 24000)}`;
    await hooks?.onAuditToken?.("\n\n", auditResponse.providerUsed);
    const continuationResponse = hooks?.onAuditToken
      ? await generateWithFallbackStreaming(
          input.provider,
          continuationPrompt,
          (token, providerUsed) => hooks.onAuditToken?.(token, providerUsed),
          { ...generationOptions, maxWords: sectionTargetWords + 120, paceMs: 2 },
        )
      : await generateWithFallback(input.provider, continuationPrompt, { ...generationOptions, maxWords: sectionTargetWords + 120 });
    if (!continuationResponse.text.trim()) throw new Error("The coherence report continuation returned no text.");
    auditProviders.add(continuationResponse.providerUsed);
    output = `${output}\n\n${continuationResponse.text.trim()}`;
    continuationIndex += 1;
  }
  if (requestedTargetWords) {
    output = trimToExactWords(output, requestedTargetWords);
    if (countWords(output) !== requestedTargetWords) {
      throw new Error(`The coherence report produced ${countWords(output)} words instead of exactly ${requestedTargetWords}.`);
    }
    await hooks?.onReplaceOutput?.(output);
  }
  const scorecard = parseScorecard(output, mode);

  if (!useHierarchicalEvidence) {
    for (const [index, chunk] of chunks.entries()) {
      await pool.query(
        `UPDATE neurotext_coherence_chunks
         SET delta = $3::jsonb, status = 'indexed'
         WHERE job_id = $1 AND chunk_index = $2`,
        [jobId, index, JSON.stringify({ wordCount: countWords(chunk), sourceAnchor: chunk.slice(0, 180) })],
      );
    }
  }
  await pool.query(
    `INSERT INTO neurotext_tractatus_tiers (id, job_id, job_type, tier, tree, node_count)
     VALUES ($1, $2, 'coherence', 1, $3::jsonb, $4)`,
    [randomUUID(), jobId, JSON.stringify({
      "1.0": `MODE: ${scorecard.mode}`,
      "1.1": `SCORE: ${scorecard.score ?? "unavailable"}`,
      "1.2": `VERDICT: ${scorecard.verdict}`,
      "1.3": scorecard.dimensions,
    }), Math.max(1, scorecard.dimensions.length + 3)],
  );
  await pool.query(
    `UPDATE neurotext_coherence_jobs
     SET final_output = $2, coherence_score = $3, coherence_report = $4::jsonb, provider_used = $5,
         status = 'complete', updated_at = NOW()
     WHERE id = $1`,
    [jobId, output, scorecard.score, JSON.stringify(scorecard), auditResponse.providerUsed],
  );

  return {
    jobId,
    status: "complete",
    providerUsed: auditResponse.providerUsed,
    skeleton: skeletonResponse.text,
    output,
    coherenceScore: scorecard.score,
    scorecard,
    providerUsage: {
      evidence: [...evidenceProviders],
      skeleton: [skeletonResponse.providerUsed],
      audit: [...auditProviders],
    } satisfies CoherenceProviderUsage,
  };
}