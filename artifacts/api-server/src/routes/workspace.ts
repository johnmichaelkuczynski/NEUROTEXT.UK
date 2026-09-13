import { Router, type IRouter } from "express";
import {
  CreateDocumentBody,
  CreateGenerationJobBody,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { runCoherenceJob } from "../services/coherence";
import { generateWithFallback, generateWithFallbackStreaming } from "../services/llm-router";
import {
  openLiveDocumentStream as openEventStream,
  writeLiveDocumentEvent as writeStreamEvent,
} from "../services/live-document-stream";
import {
  countWords as countLongFormWords,
  createPlanStartEvent,
  createSectionStartEvent,
  extractNonNegotiableThesis,
  LONG_FORM_BLOCK_WORDS,
  planLongFormBlocks,
  trimToWordCountPreservingFormatting,
  validateLongFormDocument,
  wordTargetBounds,
} from "../services/long-form-quality";
import {
  AnalyzeCoherenceBody,
  DetectAiAuthorshipBody,
  RunDiagnosticsBody,
  RunDocumentFunctionBody,
} from "@workspace/api-zod";

const functionOperations: Record<string, string> = {
  manipulator: "If no source document is supplied, create a new document entirely from the user's instructions. If source material is supplied, transform it exactly as instructed and preserve all material facts unless the user asks to remove them.",
  objections: "Generate the strongest serious objections to the document, explain why each matters, then produce a rewritten version that directly addresses them.",
  screenplay: "Create a properly formatted screenplay from the user's instructions, using any supplied source material when present, with scene headings, action, character cues, and dialogue.",
  dialogue: "Create vivid, character-distinct dialogue from the user's instructions, using any supplied source material when present.",
  maxintel: "Rewrite the source to maximize clarity, argument quality, evidence, precision, and intellectual rigor without generic filler.",
  profile: "Produce a careful cognitive profile based only on the author's writing. Analyze reasoning style, conceptual habits, use of evidence, abstraction, distinctions, assumptions, strengths, and limits. Do not infer sensitive personal traits or diagnose the author.",
  thesis: "Create a rigorous scholarly master's thesis from the user's instructions, incorporating any supplied research material and preserving supplied citations.",
  dissertation: "Create a rigorous scholarly dissertation from the user's instructions, incorporating any supplied research material and preserving supplied citations.",
  translation: "Translate the source as instructed, preserving structure, terminology, quotations, and factual claims.",
};

const thinkerContext = (thinker?: string, quotes = 0) => {
  if (!thinker) return "Use a neutral scholarly perspective.";
  const quoteGuidance = quotes > 0
    ? `Aim to include exactly ${quotes} accurate, clearly attributed quotations from ${thinker} when they are relevant and supplied by the knowledge source. If fewer can be supported, use only the verified quotations; never invent a quotation or falsely attribute a claim.`
    : "Do not include direct quotations from the thinker. Never falsely attribute a claim.";
  return `Use the intellectual perspective of ${thinker}. Draw on that thinker's documented concepts and style. ${quoteGuidance}`;
};

const FINISHED_DOCUMENT_RULES = `Return only the finished document the user can publish as-is.
Do not mention planning, outlines, skeletons, blocks, generation, prompts, models, or your process.
Do not write CONFLICT_FLAG, PERMITTED CITATION, VERIFIED SCHOLARLY METADATA, ANTI-SYCOPHANCY, OPENING BLOCK, or any other internal control label.
Do not invent studies, quotations, citations, or factual evidence.
If source material is thin, write a careful document from what is actually present. Do not narrate missing sources.`;

function stripControlLanguage(text: string) {
  return text
    .replace(/^\s*CONFLICT_FLAG:.*$/gmi, "")
    .replace(/ANTI-SYCOPHANCY CONTRACT:[\s\S]*?(?=\n[A-Z][A-Z _-]+:|\n\n|$)/g, "")
    .replace(/^\s*PERMITTED CITATION[^\n]*$/gmi, "")
    .replace(/^\s*VERIFIED SCHOLARLY METADATA[^\n]*$/gmi, "")
    .replace(/^\s*OPENING BLOCK[^\n]*$/gmi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const workspaceRouter: IRouter = Router();

type Document = {
  id: string;
  title: string;
  excerpt: string;
  words: number;
  score: number;
  updatedAt: string;
  status: string;
};

type GenerationJob = {
  id: string;
  title: string;
  feature: string;
  provider: string;
  progress: number;
  status: string;
  createdAt: string;
};

const documents: Document[] = [
  {
    id: "doc-1",
    title: "The Architecture of Attention",
    excerpt: "A study of how interfaces shape cognition, focus, and choice.",
    words: 4820,
    score: 87,
    updatedAt: "2026-08-22T14:32:00.000Z",
    status: "Analyzed",
  },
  {
    id: "doc-2",
    title: "Notes on Emergent Reasoning",
    excerpt: "Working notes on models, evidence, and the limits of synthesis.",
    words: 2160,
    score: 74,
    updatedAt: "2026-08-21T09:18:00.000Z",
    status: "Draft",
  },
];

const jobs: GenerationJob[] = [
  {
    id: "job-1",
    title: "The Architecture of Attention",
    feature: "Universal Expansion",
    provider: "ZHI 1 · OpenAI",
    progress: 100,
    status: "Complete",
    createdAt: "2026-08-22T14:34:00.000Z",
  },
  {
    id: "job-2",
    title: "Emergent Reasoning",
    feature: "Coherence Meter",
    provider: "ZHI 2 · Anthropic",
    progress: 68,
    status: "Running",
    createdAt: "2026-08-22T13:51:00.000Z",
  },
];

workspaceRouter.get("/workspace/summary", (_req, res) => {
  res.json({
    documents: documents.length,
    activeJobs: jobs.filter((job) => job.status === "Running").length,
    wordsProcessed: 124680,
    intelligenceScore: 86.4,
    credits: 8420,
    recentActivity: [
      {
        id: "activity-1",
        label: "Universal Expansion complete",
        detail: "The Architecture of Attention · 4,820 words",
        timestamp: "12 min ago",
        tone: "violet",
      },
      {
        id: "activity-2",
        label: "Coherence Meter running",
        detail: "Emergent Reasoning · 68% through pass 2",
        timestamp: "48 min ago",
        tone: "teal",
      },
      {
        id: "activity-3",
        label: "Analysis saved",
        detail: "A new 17-dimension intelligence profile is ready",
        timestamp: "Yesterday",
        tone: "amber",
      },
    ],
  });
});

workspaceRouter.get("/documents", (_req, res) => {
  res.json(documents);
});

workspaceRouter.post("/documents", (req, res) => {
  const parsed = CreateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A title and source text are required." });
    return;
  }
  const { title, content } = parsed.data;
  const document: Document = {
    id: randomUUID(),
    title,
    excerpt: content.slice(0, 120),
    words: content.trim().split(/\s+/).filter(Boolean).length,
    score: 0,
    updatedAt: new Date().toISOString(),
    status: "New",
  };
  documents.unshift(document);
  res.status(201).json(document);
});

workspaceRouter.get("/jobs", (_req, res) => {
  res.json(jobs);
});

workspaceRouter.post("/jobs", (req, res) => {
  const parsed = CreateGenerationJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A title, feature, and provider are required." });
    return;
  }
  const { title, feature, provider } = parsed.data;
  const job: GenerationJob = {
    id: randomUUID(),
    title,
    feature,
    provider,
    progress: 8,
    status: "Running",
    createdAt: new Date().toISOString(),
  };
  jobs.unshift(job);
  res.status(202).json(job);
});

workspaceRouter.post("/diagnostics/run", async (req, res) => {
  const parsed = RunDiagnosticsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A function, model, and test input are required." });
    return;
  }
  const { functionId, provider, input, thinker, quotes } = parsed.data;
  const tests = [
    {
      id: "input",
      title: "Input acceptance",
      prompt: `Confirm that this document input is readable. State its word count and one exact phrase from it.\n\n${input}`,
    },
    {
      id: "model",
      title: "Live model response",
      prompt: `For the ${functionId} operation, give a concise, substantive response to this input.\n${thinkerContext(thinker, quotes)}\n\n${input}`,
    },
    {
      id: "coherence",
      title: "Coherence probe",
      prompt: `Identify one central claim and one possible ambiguity in this text. Be specific.\n${thinkerContext(thinker, quotes)}\n\n${input}`,
    },
  ];
  const checks = [];
  for (const test of tests) {
    const started = Date.now();
    try {
      const result = await generateWithFallback(provider, test.prompt, { quotes });
      checks.push({
        id: test.id,
        title: test.title,
        status: "pass",
        input: input.slice(0, 500),
        output: result.text,
        providerUsed: result.providerUsed,
        elapsedMs: Date.now() - started,
      });
    } catch {
      checks.push({
        id: test.id,
        title: test.title,
        status: "fail",
        input: input.slice(0, 500),
        output: "The diagnostic could not complete. Please run it again.",
        providerUsed: provider,
        elapsedMs: Date.now() - started,
      });
    }
  }
  res.json({ runId: randomUUID(), checks });
});

workspaceRouter.post("/ai-detect", async (req, res) => {
  const parsed = DetectAiAuthorshipBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Text and a model are required for AI detection." });
    return;
  }
  const { text, provider } = parsed.data;
  const sample = text.length > 7000
    ? `${text.slice(0, 5000)}\n\n[...middle omitted for live analysis...]\n\n${text.slice(-2000)}`
    : text;
  const prompt = `Assess whether the supplied writing resembles text generated or substantially rewritten by a language model. Use only observable writing signals. Do not identify an author, make an academic-integrity determination, or claim certainty. Return ONLY valid JSON in this exact shape:
{"aiProbability": number from 0 to 100, "explanation": "one concise sentence of at most 24 words"}
Interpret aiProbability as a rough AI-likeness estimate, not proof. Keep it calibrated: ordinary polished prose alone is not evidence. Analyze this text:
${sample}`;
  try {
    const result = await generateWithFallback(provider, prompt, { maxWords: 100 });
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI detector did not return JSON.");
    const payload = JSON.parse(jsonMatch[0]) as { aiProbability?: unknown; explanation?: unknown };
    const aiProbability = Number(payload.aiProbability);
    if (!Number.isFinite(aiProbability)) throw new Error("AI detector returned an invalid score.");
    const score = Math.max(0, Math.min(100, Math.round(aiProbability)));
    const label = score >= 70
      ? "Likely AI-generated"
      : score >= 40
        ? "Mixed signals"
        : "Likely human-written";
    res.json({
      aiProbability: score,
      label,
      explanation: typeof payload.explanation === "string" && payload.explanation.trim()
        ? payload.explanation.trim().slice(0, 240)
        : "This estimate is based on observable writing patterns and is not definitive.",
      providerUsed: result.providerUsed,
    });
  } catch (error) {
    req.log.error({ error }, "AI detection failed");
    res.status(503).json({ error: "The AI detector could not complete. Keep writing and it will retry after your next edit." });
  }
});

workspaceRouter.post("/coherence/analyze", async (req, res) => {
  const parsed = AnalyzeCoherenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A title, document, model, and coherence mode are required." });
    return;
  }
  try {
    res.json(await runCoherenceJob(parsed.data));
  } catch (error) {
    req.log.error({ error }, "Coherence evaluation failed");
    res.status(503).json({ error: "The coherence run could not complete. Please try again." });
  }
});

workspaceRouter.post("/functions/run", async (req, res) => {
  const parsed = RunDocumentFunctionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A function, model, and valid request are required." });
    return;
  }
  const { functionId, text, instructions, targetWords, provider, thinker, quotes } = parsed.data;
  const operation = functionOperations[functionId] ?? functionOperations.manipulator;
  const prompt = `You are completing a NEUROTEXT document function.
FUNCTION: ${functionId}
TASK: ${operation}
USER INSTRUCTIONS: ${instructions || "Use your professional judgment."}
TARGET WORD LENGTH: ${targetWords || "Match the appropriate length for the request."}
INTELLECTUAL PERSPECTIVE: ${thinkerContext(thinker, quotes)}
${FINISHED_DOCUMENT_RULES}
SOURCE DOCUMENT:
${text}`;
  try {
    const result = await generateWithFallback(provider, prompt, { quotes });
    res.json({ ...result, text: stripControlLanguage(result.text) });
  } catch (error) {
    req.log.error({ error }, "Document function failed");
    res.status(503).json({ error: "The document function could not complete. Please try again." });
  }
});

const hasAuthorDateCitations = (document: string) =>
  /\((?:[A-Z][A-Za-z'’-]+(?:\s+(?:et al\.|&\s+[A-Z][A-Za-z'’-]+))?,?\s*)?(?:19|20)\d{2}[a-z]?(?:,\s*(?:p{1,2}\.\s*)?\d+(?:[-–]\d+)?)?\)/.test(document)
  || /\b[A-Z][A-Za-z'’-]+(?:\s+et al\.)?\s+\((?:19|20)\d{2}[a-z]?\)/.test(document);

const hasReferencesSection = (document: string) =>
  /(?:^|\n)\s*(?:References|Bibliography)\s*(?:\n|$)/i.test(document);

async function appendMissingApaReferences(
  res: import("express").Response,
  provider: string,
  document: string,
  quotes: number | undefined,
) {
  if (!hasAuthorDateCitations(document) || hasReferencesSection(document)) return document;
  writeStreamEvent(res, { type: "bibliography_start", style: "APA 7" });
  writeStreamEvent(res, { type: "token", text: "\n\nReferences\n\n", providerUsed: "NEUROTEXT" });
  const bibliography = await generateWithFallbackStreaming(provider, `Create the complete APA 7 References section required by the document below.
List every work cited in the document's author-date in-text citations, once each, in alphabetical order. Return reference entries only: do not add a heading, explanation, Markdown, bullets, numbering, or works that are not cited. Use legitimate bibliographic details. Never invent a title, journal, publisher, volume, issue, page range, URL, or DOI. Omit an unavailable element rather than guessing it.
DOCUMENT:
${document}`, (token, providerUsed) => {
    writeStreamEvent(res, { type: "token", text: token, providerUsed });
  }, { quotes: 0, maxWords: 1200 });
  const referenceText = bibliography.text.trim();
  if (!referenceText) throw new Error("The required APA References section was empty.");
  writeStreamEvent(res, { type: "bibliography_done", providerUsed: bibliography.providerUsed });
  return `${document}\n\nReferences\n\n${referenceText}`;
}

const STREAM_BLOCK_WORDS = LONG_FORM_BLOCK_WORDS;

const ANTI_SYCOPHANCY_CLAUSES = `- Preserve every REJECTS entry verbatim. Do not soften, qualify, or convert a REJECTS into an OPEN.
- Preserve every numerical value, date, proper name, citation, and quoted phrase exactly as it appears.
- If two entries contradict, do not silently merge them. Emit a CONFLICT_FLAG entry that quotes both.
- Defeats, negative results, and counterexamples are load-bearing. They cost more to preserve than positive claims. Preserve them anyway.
- You are not being graded on smoothness, harmony, or readability. You are being graded on whether the memory you emit can be used to detect a hallucination two chunks from now.`;

function splitForStreaming(text: string, maxWords = STREAM_BLOCK_WORDS) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += maxWords) {
    chunks.push(words.slice(index, index + maxWords).join(" "));
  }
  return chunks.length ? chunks : [text];
}

function parseTargetWordCount(value?: string) {
  if (!value) return null;
  const parsed = Number.parseInt(value.replace(/[,\s]/g, ""), 10);
  return Number.isFinite(parsed) ? Math.max(100, Math.min(100000, parsed)) : null;
}

function countTextWords(value: string) {
  return countLongFormWords(value);
}

function recentContinuity(value: string, maxWords = 350) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.slice(-maxWords).join(" ");
}

function lengthMode(inputWords: number, targetWords: number) {
  const ratio = targetWords / Math.max(1, inputWords);
  if (ratio < 0.5) return "HEAVY COMPRESSION";
  if (ratio < 0.8) return "MODERATE COMPRESSION";
  if (ratio < 1.2) return "MAINTAIN";
  if (ratio < 1.8) return "MODERATE EXPANSION";
  return "HEAVY EXPANSION";
}

function inferLongFormTarget(explicitTarget: string | undefined, instructions: string | undefined, inputWords: number, functionId: string) {
  const explicit = parseTargetWordCount(explicitTarget);
  if (explicit) return explicit;
  const request = instructions ?? "";
  const wordMatch = request.match(/\b(\d{1,3}(?:,\d{3})*|\d{3,6})\s*[- ]?words?\b/i);
  if (wordMatch) return parseTargetWordCount(wordMatch[1]);
  const pageMatch = request.match(/\b(\d{1,4})\s*[- ]?pages?\b/i);
  if (pageMatch) return Math.min(100000, Math.max(250, Number(pageMatch[1]) * 250));
  if (functionId === "manipulator" && /\b(long[- ]?form|essay|paper|chapter|book|treatise|article)\b/i.test(request)) {
    return Math.max(1000, inputWords);
  }
  return null;
}

function scheduledRest(previousWords: number, currentWords: number) {
  if (Math.floor(currentWords / 10000) > Math.floor(previousWords / 10000)) return { milestoneWords: Math.floor(currentWords / 10000) * 10000, durationMs: 15000 };
  if (Math.floor(currentWords / 5000) > Math.floor(previousWords / 5000)) return { milestoneWords: Math.floor(currentWords / 5000) * 5000, durationMs: 8000 };
  if (Math.floor(currentWords / 1000) > Math.floor(previousWords / 1000)) return { milestoneWords: Math.floor(currentWords / 1000) * 1000, durationMs: 3000 };
  return null;
}

workspaceRouter.post("/functions/stream", async (req, res) => {
  const parsed = RunDocumentFunctionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A function, model, and valid request are required." });
    return;
  }
  const { functionId, text, instructions, targetWords, provider, thinker, quotes, resumeDocument, resumeSkeleton } = parsed.data;
  const cleanSource = stripControlLanguage(text);
  const operation = `${functionOperations[functionId] ?? functionOperations.manipulator} Preserve all facts, terminology, quotations, and negative results. ${instructions || "Use professional judgment."} ${thinkerContext(thinker, quotes)}`;
  const chunks = splitForStreaming(cleanSource);
  openEventStream(res);
  try {
    const inputWords = countTextWords(cleanSource);
    const requestedTargetWords = inferLongFormTarget(targetWords, instructions, inputWords, functionId);
    if (requestedTargetWords) {
      const expansionMode = lengthMode(inputWords, requestedTargetWords);
      const blockPlan = planLongFormBlocks(requestedTargetWords);
      const estimatedBlocks = blockPlan.blocks.length;
      const nonNegotiableThesis = extractNonNegotiableThesis(instructions);
      writeStreamEvent(res, createPlanStartEvent(requestedTargetWords, estimatedBlocks));
      (res as import("express").Response & { flush?: () => void }).flush?.();
      const blueprintPrompt = `Extract a rigorous global skeleton for a ${requestedTargetWords}-word NEUROTEXT document. This skeleton will constrain every generated block.
FUNCTION: ${functionId}
TASK: ${operation}
INPUT WORDS: ${inputWords}
TARGET WORDS: ${requestedTargetWords}
LENGTH MODE: ${expansionMode}
SOURCE DOCUMENT:
${cleanSource}
Return a compact working skeleton, not the finished paper, using these exact headings:
THESIS: The exact central thesis in 1-3 sentences.
${nonNegotiableThesis ? `NON-NEGOTIABLE THESIS: Preserve this position explicitly in the opening, middle, and conclusion: ${nonNegotiableThesis}` : ""}
OUTLINE: 8-20 numbered sections or claims, each with its purpose and approximate word budget; budgets must total ${requestedTargetWords}.
KEY TERMS: Important terms with the exact meanings they must retain.
COMMITMENT LEDGER: Numbered ASSERTS, REJECTS, and ASSUMES entries.
ENTITIES: People, organizations, examples, and technical terms requiring consistent reference.
OPEN: Unresolved questions that later sections must answer or explicitly leave open.
CROSS_REF: Dependencies among claims or planned sections.
CONFLICT_FLAG: Any source-level tensions that must remain visible rather than being silently harmonized.
AUDIENCE PARAMETERS: Infer only what the user instructions warrant.
RIGOR LEVEL: State the scholarly standard and evidence limits.
ARGUMENT PATH: Explain the logical progression connecting the sections.
OBJECTIONS AND REPLIES: Include only objections and replies warranted by the source.
ANTI-SYCOPHANCY CONTRACT:
${ANTI_SYCOPHANCY_CLAUSES}
Do not dilute, reverse, or replace the source's thesis. Do not invent studies, quotations, citations, or empirical findings. Expansion must develop the source's actual argument rather than turning it into generic academic prose.`;
      const openingBlockWords = Math.min(STREAM_BLOCK_WORDS, requestedTargetWords);
      const openingResult = resumeDocument?.trim()
        ? null
        : await generateWithFallbackStreaming(provider, `Write the opening block of this long-form NEUROTEXT document now.
FUNCTION: ${functionId}
TASK: ${operation}
TARGET LENGTH FOR THE COMPLETE DOCUMENT: ${requestedTargetWords} words
OPENING BLOCK LENGTH: approximately ${openingBlockWords} words.
${FINISHED_DOCUMENT_RULES}
ORIGINAL SOURCE:
${cleanSource}
Begin with the finished document's title and substantive opening prose. State and preserve the source's actual thesis.`, (token, providerUsed) => {
          writeStreamEvent(res, {
            type: "token",
            index: 0,
            total: estimatedBlocks,
            text: token,
            providerUsed,
          });
        }, { quotes, maxWords: openingBlockWords + 30 });
      const blueprintResult = resumeSkeleton?.trim()
        ? { text: resumeSkeleton.trim(), providerUsed: "Saved outline" }
        : await generateWithFallbackStreaming(provider, blueprintPrompt, (token, providerUsed) => {
          writeStreamEvent(res, { type: "skeleton_token", text: token, providerUsed });
        }, { quotes, maxWords: Math.min(800, Math.max(200, Math.ceil(requestedTargetWords * 0.12))) });
      writeStreamEvent(res, {
        type: "plan_ready",
        targetWords: requestedTargetWords,
        total: estimatedBlocks,
        providerUsed: blueprintResult.providerUsed,
        skeleton: blueprintResult.text,
      });
      (res as import("express").Response & { flush?: () => void }).flush?.();
      let generatedDocument = stripControlLanguage(resumeDocument?.trim() ?? openingResult?.text.trim() ?? "");
      let generatedWords = countTextWords(generatedDocument);
      let blockIndex = openingResult ? 1 : generatedDocument ? Math.floor(generatedWords / STREAM_BLOCK_WORDS) : 0;
      if (openingResult) {
        writeStreamEvent(res, {
          type: "section_done",
          index: 0,
          total: estimatedBlocks,
          generatedWords,
          targetWords: requestedTargetWords,
          providerUsed: openingResult.providerUsed,
          text: stripControlLanguage(openingResult.text),
        });
      } else if (generatedDocument) {
        writeStreamEvent(res, { type: "resume_ready", generatedWords, targetWords: requestedTargetWords, index: blockIndex, total: estimatedBlocks });
      }
      const minimumWords = blockPlan.minimumWords;
      const maximumBlocks = Math.ceil(requestedTargetWords / 120) + 2;
      while (generatedWords < minimumWords && blockIndex < maximumBlocks && !res.destroyed) {
        const remainingWords = requestedTargetWords - generatedWords;
        const blockTarget = Math.min(STREAM_BLOCK_WORDS, Math.max(80, remainingWords));
        const visibleTotal = Math.max(estimatedBlocks, blockIndex + 1);
        writeStreamEvent(res, createSectionStartEvent({
          index: blockIndex,
          total: visibleTotal,
          generatedWords,
          targetWords: requestedTargetWords,
        }));
        (res as import("express").Response & { flush?: () => void }).flush?.();
        const continuity = generatedDocument
          ? countTextWords(generatedDocument) <= 7000
            ? generatedDocument
            : recentContinuity(generatedDocument, 1200)
          : "[This is the opening block. Begin with the title and a substantive opening, not process commentary.]";
        const forwardBlockToken = (token: string, providerUsed: string) => {
          writeStreamEvent(res, {
            type: "token",
            index: blockIndex,
            total: visibleTotal,
            text: token,
            providerUsed,
          });
          (res as import("express").Response & { flush?: () => void }).flush?.();
        };
        const blockResult = await generateWithFallbackStreaming(provider, `Write the next block of a long-form NEUROTEXT document.
FUNCTION: ${functionId}
TASK: ${operation}
LENGTH MODE: ${expansionMode}
TARGET LENGTH FOR THE COMPLETE DOCUMENT: ${requestedTargetWords} words
WORDS ALREADY WRITTEN: ${generatedWords}
THIS BLOCK: ${blockIndex + 1}; write approximately ${blockTarget} words and no more than ${Math.min(240, blockTarget + 30)} words.
GLOBAL SKELETON — binding constraints. Use these as silent constraints. Do not quote skeleton headings or control labels in the document:
${blueprintResult.text}
${nonNegotiableThesis ? `\nNON-NEGOTIABLE THESIS — restate and defend this position in this third of the paper: ${nonNegotiableThesis}` : ""}
${FINISHED_DOCUMENT_RULES}
ORIGINAL SOURCE:
${cleanSource}
COMPLETE DOCUMENT WRITTEN SO FAR:
${continuity}
Write only the next continuous portion of the finished document. Follow the skeleton's section order and continue exactly where the preceding prose stops. Preserve and deepen the source's thesis, distinctive reasoning, terminology, examples, and argumentative direction.`, forwardBlockToken, { quotes, maxWords: Math.min(240, blockTarget + 30) });
        let blockText = stripControlLanguage(blockResult.text);
        if (!blockText) throw new Error("The long-form model returned an empty block.");
        const minimumBlockWords = Math.floor(blockTarget * 0.8);
        const initialBlockWords = countTextWords(blockText);
        if (initialBlockWords < minimumBlockWords && !res.destroyed) {
          const missingWords = blockTarget - initialBlockWords;
          writeStreamEvent(res, {
            type: "block_repair",
            index: blockIndex,
            total: visibleTotal,
            actualWords: initialBlockWords,
            targetWords: blockTarget,
          });
          writeStreamEvent(res, {
            type: "token",
            index: blockIndex,
            total: visibleTotal,
            text: " ",
            providerUsed: blockResult.providerUsed,
          });
          const supplement = await generateWithFallbackStreaming(provider, `Continue this exact document block with approximately ${missingWords} additional substantive words.
${FINISHED_DOCUMENT_RULES}
BLOCK WRITTEN SO FAR:
${blockText}
Continue directly from its final sentence. Add warranted analysis, implications, distinctions, or connective reasoning. Return only the continuation.`, forwardBlockToken, { quotes, maxWords: Math.min(120, missingWords + 20) });
          blockText = stripControlLanguage(`${blockText} ${supplement.text}`.trim());
        }
        const previousWords = generatedWords;
        generatedDocument = generatedDocument ? `${generatedDocument}\n\n${blockText}` : blockText;
        generatedWords = countTextWords(generatedDocument);
        writeStreamEvent(res, {
          type: "section_done",
          index: blockIndex,
          total: visibleTotal,
          generatedWords,
          targetWords: requestedTargetWords,
          providerUsed: blockResult.providerUsed,
          text: blockText,
        });
        (res as import("express").Response & { flush?: () => void }).flush?.();
        blockIndex += 1;
        const rest = scheduledRest(previousWords, generatedWords);
        if (rest && !res.destroyed && generatedWords < minimumWords) {
          writeStreamEvent(res, { type: "rest_start", ...rest, generatedWords });
          (res as import("express").Response & { flush?: () => void }).flush?.();
          await new Promise((resolve) => setTimeout(resolve, rest.durationMs));
          writeStreamEvent(res, { type: "rest_done", milestoneWords: rest.milestoneWords, generatedWords });
        }
      }
      if (res.destroyed) return;
      writeStreamEvent(res, { type: "validation_start", generatedWords, targetWords: requestedTargetWords });
      (res as import("express").Response & { flush?: () => void }).flush?.();
      try {
        const validationResult = await generateWithFallback(provider, `Perform the final cross-block consistency stitch for this document.
GLOBAL SKELETON:
${blueprintResult.text}
COMPLETE GENERATED DOCUMENT:
${generatedDocument}
Audit for:
1. Contradictions with the thesis or commitment ledger.
2. Key-term drift.
3. Redundant passages that repeat the same point without adding analysis.
4. Structural gaps relative to the outline.
5. Broken transitions or cross-references.
Return ONLY valid JSON in this form:
{"repairs":[{"find":"an exact excerpt copied from the document","replace":"the minimally repaired replacement","reason":"brief reason"}]}
Use no more than 8 repairs. Make only necessary local repairs. The find value must be an exact contiguous excerpt from the generated document between 20 and 800 characters. The replacement must preserve the intended thesis and must not invent citations, studies, quotations, or evidence. If no repair is necessary, return {"repairs":[]}.`, { quotes: 0, maxWords: 900 });
        const validationJson = validationResult.text.match(/\{[\s\S]*\}/);
        const parsedValidation = validationJson
          ? JSON.parse(validationJson[0]) as { repairs?: Array<{ find?: unknown; replace?: unknown }> }
          : { repairs: [] };
        let appliedRepairs = 0;
        for (const repair of parsedValidation.repairs ?? []) {
          if (typeof repair.find !== "string" || typeof repair.replace !== "string") continue;
          const find = repair.find.trim();
          const replacement = stripControlLanguage(repair.replace);
          if (find.length < 20 || find.length > 800 || !replacement || replacement.length > 1600) continue;
          if (!generatedDocument.includes(find)) continue;
          generatedDocument = generatedDocument.replace(find, replacement);
          appliedRepairs += 1;
        }
        generatedWords = countTextWords(generatedDocument);
        if (appliedRepairs > 0) {
          writeStreamEvent(res, { type: "replace_output", text: generatedDocument, generatedWords });
        }
        writeStreamEvent(res, {
          type: "validation_done",
          repairs: appliedRepairs,
          generatedWords,
          providerUsed: validationResult.providerUsed,
        });
      } catch (validationError) {
        req.log.warn({ error: validationError }, "Long-form consistency stitch could not apply repairs");
        writeStreamEvent(res, { type: "validation_done", repairs: 0, generatedWords, status: "unavailable" });
      }
      generatedDocument = stripControlLanguage(await appendMissingApaReferences(res, provider, generatedDocument, quotes));
      generatedWords = countTextWords(generatedDocument);
      const { maximumWords: maximumAcceptedWords } = wordTargetBounds(requestedTargetWords);
      if (generatedWords > maximumAcceptedWords) {
        generatedDocument = trimToWordCountPreservingFormatting(generatedDocument, requestedTargetWords);
        generatedWords = countTextWords(generatedDocument);
        writeStreamEvent(res, {
          type: "replace_output",
          text: generatedDocument,
          generatedWords,
          reason: "word_target_tolerance",
        });
      }
      const quality = validateLongFormDocument({
        document: generatedDocument,
        source: cleanSource,
        targetWords: requestedTargetWords,
        nonNegotiableThesis,
      });
      if (!quality.passed) {
        writeStreamEvent(res, {
          type: "quality_failed",
          failures: quality.failures,
          generatedWords: quality.generatedWords,
          minimumWords: quality.minimumWords,
        });
        writeStreamEvent(res, {
          type: "error",
          message: "The generated document failed the long-form quality check and was not accepted.",
        });
        return;
      }
      writeStreamEvent(res, {
        type: "quality_passed",
        generatedWords: quality.generatedWords,
        minimumWords: quality.minimumWords,
      });
      writeStreamEvent(res, {
        type: "done",
        generatedWords,
        targetWords: requestedTargetWords,
        blocks: blockIndex,
      });
      return;
    }
    let generatedDocument = "";
    for (const [index, chunk] of chunks.entries()) {
      writeStreamEvent(res, { type: "section_start", index, total: chunks.length, maxWords: STREAM_BLOCK_WORDS });
      const blockResult = await generateWithFallbackStreaming(provider, `${operation}
This is block ${index + 1} of ${chunks.length}. Return a complete, useful block now; do not refer to future blocks. Keep this block to no more than ${STREAM_BLOCK_WORDS} words so it can be reviewed while the rest is generated.
Target total length: ${targetWords || "appropriate length"}.
${FINISHED_DOCUMENT_RULES}
      SOURCE SECTION:
${chunk}`, (token, providerUsed) => {
        writeStreamEvent(res, { type: "token", index, total: chunks.length, text: token, providerUsed });
        (res as import("express").Response & { flush?: () => void }).flush?.();
      }, { quotes, maxWords: STREAM_BLOCK_WORDS });
      const blockText = stripControlLanguage(blockResult.text);
      generatedDocument = generatedDocument
        ? `${generatedDocument}\n\n${blockText}`
        : blockText;
      writeStreamEvent(res, { type: "section_done", index, total: chunks.length, text: blockText, generatedWords: countTextWords(blockText) });
    }
    generatedDocument = stripControlLanguage(await appendMissingApaReferences(res, provider, generatedDocument, quotes));
    writeStreamEvent(res, { type: "done", generatedWords: countTextWords(generatedDocument) });
  } catch (error) {
    req.log.error({ error }, "Streaming document function failed");
    writeStreamEvent(res, { type: "error", message: "The document function could not complete." });
  } finally {
    res.end();
  }
});

workspaceRouter.post("/coherence/stream", async (req, res) => {
  const parsed = AnalyzeCoherenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A title, document, model, and coherence mode are required." });
    return;
  }
  openEventStream(res);
  try {
    writeStreamEvent(res, {
      type: "analysis_started",
      mode: parsed.data.mode,
      requestedProvider: parsed.data.provider,
    });
    const result = await runCoherenceJob({
      ...parsed.data,
      text: stripControlLanguage(parsed.data.text),
    }, {
      onSkeleton: (text, providerUsed) => {
        writeStreamEvent(res, { type: "skeleton", text, providerUsed });
      },
      onSkeletonToken: (text, providerUsed) => {
        writeStreamEvent(res, { type: "skeleton_token", text, providerUsed });
        (res as import("express").Response & { flush?: () => void }).flush?.();
      },
      onEvidenceToken: (text, index, total, providerUsed) => {
        writeStreamEvent(res, { type: "evidence_token", text, index, total, providerUsed });
        (res as import("express").Response & { flush?: () => void }).flush?.();
      },
      onAuditToken: (text, providerUsed) => {
        writeStreamEvent(res, { type: "token", text, providerUsed });
        (res as import("express").Response & { flush?: () => void }).flush?.();
      },
    });
    writeStreamEvent(res, {
      type: "done",
      jobId: result.jobId,
      coherenceScore: result.coherenceScore,
      scorecard: result.scorecard,
      providerUsed: result.providerUsed,
      mode: result.scorecard.mode,
      providerUsage: result.providerUsage,
    });
  } catch (error) {
    req.log.error({ error }, "Streaming coherence evaluation failed");
    writeStreamEvent(res, { type: "error", message: "The coherence run could not complete." });
  } finally {
    res.end();
  }
});

workspaceRouter.post("/ocr", async (req, res) => {
  const imageData = typeof req.body?.imageData === "string" ? req.body.imageData : "";
  if (!imageData.startsWith("data:image/")) {
    res.status(400).json({ error: "Upload a valid image to extract its text." });
    return;
  }
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.6-terra",
      max_completion_tokens: 8192,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Extract all readable text from this document image. Preserve headings, paragraphs, lists, dates, numbers, and quotations. Return only the extracted text." },
          { type: "image_url", image_url: { url: imageData } },
        ],
      }],
    });
    res.json({ text: response.choices[0]?.message?.content?.trim() ?? "" });
  } catch (error) {
    req.log.error({ error }, "OCR extraction failed");
    res.status(503).json({ error: "Text extraction could not complete. Please try again." });
  }
});

workspaceRouter.post("/visitors/register", async (req, res) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS neurotext_visitors (
      visitor_id TEXT PRIMARY KEY,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const visitorId = typeof req.body?.visitorId === "string" ? req.body.visitorId : randomUUID();
  await pool.query(
    `INSERT INTO neurotext_visitors (visitor_id) VALUES ($1)
     ON CONFLICT (visitor_id) DO UPDATE SET last_seen = NOW()`,
    [visitorId],
  );
  const result = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM neurotext_visitors",
  );
  res.json({ visitorId, count: Number(result.rows[0]?.count ?? 0) });
});

export default workspaceRouter;