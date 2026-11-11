import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, count, eq } from "drizzle-orm";
import {
  GetDiagnosticsResponse,
  GetWorkspaceParams,
  GetWorkspaceResponse,
  ListWorkspacesResponse,
  RegisterVisitorBody,
  RegisterVisitorResponse,
  SaveWorkspaceBody,
  SaveWorkspaceParams,
  SaveWorkspaceResponse,
  StreamCoherenceBody,
  StreamFunctionBody,
  TransferDocumentBody,
  TransferDocumentResponse,
} from "@workspace/api-zod";
import {
  db,
  neurotextDiagnostics,
  neurotextUsage,
  neurotextVisitors,
  neurotextWorkspaces,
} from "@workspace/db";
import { getAnthropic } from "@workspace/integrations-anthropic-ai";
import OpenAI from "openai";
import { createLiveDocumentStream } from "../services/live-document-stream";
import { DOCUMENT_SYSTEM_PROMPT, documentInputSection, separateLegacyDraft } from "../services/document-inputs";
import { academicChapterCount } from "../services/academic-structure";
import { generateAcademicDocument } from "../services/academic-generation";
import { HOMEWORK_SYSTEM_PROMPT, homeworkPrompt } from "../services/homework";

const router: IRouter = Router();

const FUNCTION_NAMES = [
  "Document Creator & Manipulator",
  "Objections & Bullet-Proof Rewrite",
  "Screenplay Generator",
  "Dialogue Generation",
  "Coherence Evaluator",
  "Maximum Intelligence Rewriter",
  "Cognitive Profiling",
  "Master's Thesis Creator",
  "Dissertation Creator",
  "Homework",
] as const;

const MINIMUMS = [4000, 6500, 4000, 4000, 4000, 8000, 4000, 20000, 45000, 100];
const DEFAULT_INSTRUCTION =
  "Turn the source material into a rigorous 5,000-word scholarly essay, replete with relevant legitimate scholarly studies and evidence. Include supported APA-style in-text citations and a complete APA 7 References bibliography. Do not invent sources, quotations, findings, authors, titles, dates, or publication details.";
const DEFAULT_MODEL = "ZHI 6 · Perplexity Sonar Pro";
const LEGACY_DEFAULT_MODEL = "ZHI 1 · OpenAI GPT-5.6 Terra";

function selectedProvider(label: string) {
  if (label.startsWith("ZHI 6")) {
    return { kind: "perplexity" as const, model: "sonar-pro", name: "Perplexity Sonar Pro" };
  }
  if (label.startsWith("ZHI 2")) {
    return { kind: "anthropic" as const, model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5", name: "Anthropic" };
  }
  if (label.startsWith("ZHI 3")) {
    return { kind: "xai" as const, model: process.env.XAI_MODEL || "grok-4", name: "xAI Grok" };
  }
  if (label.startsWith("ZHI 4")) {
    return { kind: "deepseek" as const, model: process.env.DEEPSEEK_MODEL || "deepseek-chat", name: "DeepSeek" };
  }
  if (label.startsWith("ZHI 5")) {
    return { kind: "venice" as const, model: "zai-org-glm-5-1", name: "Venice AI" };
  }
  if (label.startsWith("ZHI 1")) {
    return { kind: "openai" as const, model: process.env.OPENAI_MODEL || "gpt-5", name: "OpenAI" };
  }
  return { kind: "perplexity" as const, model: "sonar-pro", name: "Perplexity Sonar Pro" };
}

function directClient(kind: "openai" | "perplexity" | "xai" | "deepseek" | "venice") {
  const config = {
    openai: { key: "OPENAI_API_KEY", baseURL: "https://api.openai.com/v1" },
    perplexity: { key: "PERPLEXITY_API_KEY", baseURL: "https://api.perplexity.ai" },
    xai: { key: "XAI_API_KEY", baseURL: "https://api.x.ai/v1" },
    deepseek: { key: "DEEPSEEK_API_KEY", baseURL: "https://api.deepseek.com" },
    venice: { key: "VENICE_API_KEY", baseURL: "https://api.venice.ai/api/v1" },
  }[kind];
  const apiKey = process.env[config.key];
  if (!apiKey) throw new Error(`${config.key} is not configured. Add this provider's API key to the server environment.`);
  return new OpenAI({ apiKey, baseURL: config.baseURL });
}

type WorkspacePayload = {
  instructions: string;
  instructionDraft: string;
  sourceDocument: string;
  targetWords: number;
  selectedModel: string;
  thinker: string;
  quotationCount: number;
  output: string;
  generationError: string;
  skeleton: string;
  progress: number;
  status: "idle" | "preparing" | "writing" | "interrupted" | "failed" | "complete";
  provider: string;
};

function defaultWorkspace(functionId: number): WorkspacePayload {
  return {
    instructions: functionId === 1 ? DEFAULT_INSTRUCTION : "",
    instructionDraft: "",
    sourceDocument: "",
    targetWords: functionId === 10 ? 500 : functionId === 1 ? 5000 : MINIMUMS[functionId - 1] ?? 4000,
    selectedModel: DEFAULT_MODEL,
    thinker: "Standard NEUROTEXT style",
    quotationCount: 0,
    output: "",
    generationError: "",
    skeleton: "",
    progress: 0,
    status: "idle",
    provider: "",
  };
}

function sessionId(req: Parameters<typeof router.get>[1] extends never ? never : any) {
  const existing = req.cookies?.neurotext_session;
  return typeof existing === "string" && existing.length > 10 ? existing : randomUUID();
}

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function normalizeWorkspace(functionId: number, payload: unknown, updatedAt = new Date()) {
  const merged = separateLegacyDraft({ ...defaultWorkspace(functionId), ...(payload as object) } as WorkspacePayload);
  if (
    merged.selectedModel === LEGACY_DEFAULT_MODEL &&
    merged.status === "idle" &&
    !merged.output &&
    !merged.provider
  ) {
    merged.selectedModel = DEFAULT_MODEL;
  }
  return {
    functionId,
    ...merged,
    updatedAt: updatedAt.toISOString(),
  };
}

function promptFor(data: typeof StreamFunctionBody._output, current: string, remaining: number) {
  const functionName = FUNCTION_NAMES[data.functionId - 1];
  const continuity = current ? current.slice(-9000) : "";
  const finalBlock = remaining <= 1700;
  const scholarly = [1, 2, 5, 6, 8, 9].includes(data.functionId)
    ? finalBlock
      ? "Use only well-established scholarly sources you can identify accurately. Include supported author-date in-text citations. This is the final generation block: finish all remaining substantive sections first, then add exactly one matching References or Bibliography section as the final section of the entire document. Nothing may appear after that section. Never invent bibliographic details."
      : "Use only well-established scholarly sources you can identify accurately and include supported author-date in-text citations. Do not write a References, Bibliography, Works Cited, sources list, acknowledgments, appendix, concluding back matter, or any other end matter in this block. Those belong only in the final generation block. Never invent bibliographic details."
    : "";
  const dissertationSequence = data.functionId === 9
    ? finalBlock
      ? "Complete the dissertation's remaining chapter content and final conclusion before writing the bibliography. The bibliography must be the last section of the dissertation."
      : "Continue the dissertation's ordered chapters only. Do not insert a bibliography or references list between chapters, and do not prematurely conclude the dissertation."
    : "";
  return `You are NEUROTEXT Function ${String(data.functionId).padStart(2, "0")}: ${functionName}.
Produce finished document prose only: no planning notes, generation commentary, markdown fences, quality reports, or internal labels.
${documentInputSection(data)}
Target total: ${data.targetWords} words. This block should add approximately ${Math.min(1500, remaining)} substantive words.
${data.thinker && data.thinker !== "Standard NEUROTEXT style" ? `Use the intellectual perspective of ${data.thinker}, without fabricated quotations.` : ""}
${scholarly}
${dissertationSequence}
${continuity ? `Continue the existing document without repeating its title, opening, completed sections, or claims. Recent context:\n${continuity}` : "Begin immediately with the title and opening prose."}
Keep paragraphs to eight sentences or fewer. Preserve the central thesis, terminology, and continuity. Do not conclude until the whole requested document is complete.`;
}

async function streamGeneration(req: any, res: any, coherence = false): Promise<void> {
  const schema = coherence ? StreamCoherenceBody : StreamFunctionBody;
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = separateLegacyDraft(parsed.data);
  if (data.functionId === 10 && !data.instructions.trim()) {
    res.status(400).json({ error: "Paste, type or upload an assignment first." });
    return;
  }
  const minimum = MINIMUMS[data.functionId - 1] ?? 4000;
  if (data.targetWords < minimum && !data.diagnostic) {
    res.status(400).json({
      error: `Function ${String(data.functionId).padStart(2, "0")} has a hard lower limit of ${minimum.toLocaleString()} words.`,
    });
    return;
  }

  const sid = sessionId(req);

  const [usage] = await db
    .select()
    .from(neurotextUsage)
    .where(eq(neurotextUsage.sessionId, sid))
    .limit(1);
  if ((usage?.operationsUsed ?? 0) >= 3 && process.env.NODE_ENV === "production") {
    res.status(429).json({ error: "Anonymous allowance used. Sign in to continue." });
    return;
  }

  const stream = createLiveDocumentStream(req, res);
  stream.send({ type: "status", status: "preparing", message: "Preparing document" });

  let document = data.resumeFrom ?? "";
  let words = wordCount(document);
  const started = Date.now();
  let firstWordMs = 0;
  const provider = selectedProvider(data.selectedModel);

  try {
    const onContent = (content: string) => {
      if (!content || stream.isClosed()) return;
      if (!firstWordMs && /\S/.test(content)) firstWordMs = Date.now() - started;
      document += content;
      words = wordCount(document);
      stream.send({ type: "token", content });
      stream.send({
        type: "progress",
        words,
        target: data.targetWords,
        percent: Math.min(99, Math.round((words / data.targetWords) * 100)),
      });
    };
    const generate = async (system: string, prompt: string, consume: (text: string) => void, maxTokens = 8192) => {
      const messages = [
        { role: "system" as const, content: system },
        { role: "user" as const, content: prompt },
      ];
      if (provider.kind === "anthropic") {
        const completion = getAnthropic().messages.stream({
          model: provider.model,
          max_tokens: maxTokens,
          system: messages[0].content,
          messages: [{ role: "user", content: messages[1].content }],
        });
        for await (const event of completion) {
          if (stream.isClosed()) { completion.abort(); break; }
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            consume(event.delta.text);
          }
        }
      } else {
        const client = directClient(provider.kind);
        const completion = await client.chat.completions.create({
          model: provider.model,
          ...(provider.kind === "openai" ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
          stream: true,
          messages,
        });
        for await (const chunk of completion) {
          if (stream.isClosed()) { completion.controller.abort(); break; }
          consume(chunk.choices[0]?.delta?.content ?? "");
        }
      }
    };

    if (data.functionId === 10) {
      await generate(HOMEWORK_SYSTEM_PROMPT, homeworkPrompt(data, document), onContent, 16384);
      if (!document.trim()) throw new Error("The selected provider returned no homework answer.");
    } else if (academicChapterCount(data.functionId)) {
      await generateAcademicDocument({
        data,
        generate,
        emit: onContent,
        isClosed: stream.isClosed,
        status: message => { stream.send({ type: "status", status: "writing", message }); },
      });
    } else {
      while (words < data.targetWords && !stream.isClosed()) {
        const remaining = data.targetWords - words;
        stream.send({ type: "status", status: "writing", message: "Writing live" });
        let block = "";
        await generate(DOCUMENT_SYSTEM_PROMPT, promptFor(data, document, remaining), content => {
          block += content;
          onContent(content);
        });
        if (!block.trim()) throw new Error("The selected provider returned no document text.");
        if (wordCount(block) < 80 && words < data.targetWords) {
          throw new Error("The selected provider stopped before completing a substantive block.");
        }
      }
    }
    if (stream.isClosed()) return;

    const finalWords = wordCount(document);
    const valid = data.functionId === 10 ? finalWords > 0 : finalWords >= Math.ceil(data.targetWords * 0.9);
    if (!valid) throw new Error(`Generation stopped at ${finalWords} of ${data.targetWords} requested words.`);

    await db
      .insert(neurotextUsage)
      .values({ sessionId: sid, operationsUsed: 1 })
      .onConflictDoUpdate({
        target: neurotextUsage.sessionId,
        set: {
          operationsUsed: (usage?.operationsUsed ?? 0) + 1,
          updatedAt: new Date(),
        },
      });

    if (data.diagnostic) {
      await db.insert(neurotextDiagnostics).values({
        id: randomUUID(),
        functionId: data.functionId,
        functionName: FUNCTION_NAMES[data.functionId - 1] ?? "Unknown",
        status: valid && firstWordMs <= 8000 ? "pass" : "fail",
        elapsedMs: Date.now() - started,
        firstWordMs,
        wordCount: finalWords,
        selectedModel: data.selectedModel,
        provider: provider.name,
        cause: valid ? "" : "Target validation failed",
      });
    }

    stream.send({
      type: "complete",
      words: finalWords,
      target: data.targetWords,
      provider: provider.name,
      validated: true,
    });
    stream.finish();
  } catch (error) {
    req.log.error({ err: error }, "NEUROTEXT generation failed");
    stream.send({
      type: "error",
      code: "GENERATION_FAILED",
      message: error instanceof Error ? error.message : "Generation failed",
    });
    stream.finish();
  }
}

router.get("/functions/workspaces", async (req, res): Promise<void> => {
  const sid = sessionId(req);
  const rows = await db
    .select()
    .from(neurotextWorkspaces)
    .where(eq(neurotextWorkspaces.sessionId, sid));
  const rowMap = new Map(rows.map((row) => [row.functionId, row]));
  const workspaces = Array.from({ length: 10 }, (_, index) => {
    const functionId = index + 1;
    const row = rowMap.get(functionId);
    return normalizeWorkspace(functionId, row?.payload, row?.updatedAt);
  });
  res.json(ListWorkspacesResponse.parse(workspaces));
});

router.get("/functions/workspaces/:functionId", async (req, res): Promise<void> => {
  const params = GetWorkspaceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const sid = sessionId(req);
  const [row] = await db
    .select()
    .from(neurotextWorkspaces)
    .where(
      and(
        eq(neurotextWorkspaces.sessionId, sid),
        eq(neurotextWorkspaces.functionId, params.data.functionId),
      ),
    )
    .limit(1);
  res.json(
    GetWorkspaceResponse.parse(
      normalizeWorkspace(params.data.functionId, row?.payload, row?.updatedAt),
    ),
  );
});

router.put("/functions/workspaces/:functionId", async (req, res): Promise<void> => {
  const params = SaveWorkspaceParams.safeParse(req.params);
  const body = SaveWorkspaceBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const sid = sessionId(req);
  const updatedAt = new Date();
  await db
    .insert(neurotextWorkspaces)
    .values({
      sessionId: sid,
      functionId: params.data.functionId,
      payload: body.data,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [neurotextWorkspaces.sessionId, neurotextWorkspaces.functionId],
      set: { payload: body.data, updatedAt },
    });
  res.json(
    SaveWorkspaceResponse.parse(
      normalizeWorkspace(params.data.functionId, body.data, updatedAt),
    ),
  );
});

router.post("/functions/transfer", async (req, res): Promise<void> => {
  const parsed = TransferDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const sid = sessionId(req);
  const destinationId = parsed.data.destinationFunctionId;
  const [existing] = await db
    .select()
    .from(neurotextWorkspaces)
    .where(
      and(
        eq(neurotextWorkspaces.sessionId, sid),
        eq(neurotextWorkspaces.functionId, destinationId),
      ),
    )
    .limit(1);
  const current = normalizeWorkspace(destinationId, existing?.payload, existing?.updatedAt);
  const payload = { ...current, sourceDocument: parsed.data.document };
  const { functionId: _functionId, updatedAt: _updatedAt, ...saved } = payload;
  const now = new Date();
  await db
    .insert(neurotextWorkspaces)
    .values({ sessionId: sid, functionId: destinationId, payload: saved, updatedAt: now })
    .onConflictDoUpdate({
      target: [neurotextWorkspaces.sessionId, neurotextWorkspaces.functionId],
      set: { payload: saved, updatedAt: now },
    });
  res.json(
    TransferDocumentResponse.parse({
      sourceFunctionId: parsed.data.sourceFunctionId,
      destinationFunctionId: destinationId,
      destination: normalizeWorkspace(destinationId, saved, now),
    }),
  );
});

router.post("/visitors/register", async (req, res): Promise<void> => {
  const parsed = RegisterVisitorBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const visitorId = parsed.data.visitorId || sessionId(req);
  const inserted = await db
    .insert(neurotextVisitors)
    .values({ visitorId })
    .onConflictDoNothing()
    .returning();
  const [total] = await db.select({ count: count() }).from(neurotextVisitors);
  res.json(
    RegisterVisitorResponse.parse({
      visitorCount: total?.count ?? 0,
      registered: inserted.length > 0,
    }),
  );
});

router.get("/usage", async (req, res): Promise<void> => {
  const sid = sessionId(req);
  const [usage] = await db
    .select()
    .from(neurotextUsage)
    .where(eq(neurotextUsage.sessionId, sid))
    .limit(1);
  const [visitors] = await db.select({ count: count() }).from(neurotextVisitors);
  const used = usage?.operationsUsed ?? 0;
  res.json({
    accessState: process.env.NODE_ENV === "development" ? "development-owner" : "anonymous",
    operationsUsed: used,
    operationsRemaining: process.env.NODE_ENV === "development" ? 999999 : Math.max(0, 3 - used),
    visitorCount: visitors?.count ?? 0,
    subscriptionStatus: "not configured",
    signedIn: false,
  });
});

router.get("/diagnostics", async (_req, res): Promise<void> => {
  const rows = await db.select().from(neurotextDiagnostics);
  res.json(
    GetDiagnosticsResponse.parse(
      rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    ),
  );
});

router.post("/functions/stream", (req, res) => void streamGeneration(req, res));
router.post("/coherence/stream", (req, res) => void streamGeneration(req, res, true));

export default router;