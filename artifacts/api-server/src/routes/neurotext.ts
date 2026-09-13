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
import { openai } from "@workspace/integrations-openai-ai-server";
import { openrouter } from "@workspace/integrations-openrouter-ai";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import OpenAI from "openai";
import { createLiveDocumentStream } from "../services/live-document-stream";

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
  "Document Translation",
] as const;

const MINIMUMS = [4000, 6500, 4000, 4000, 4000, 8000, 4000, 20000, 45000, 4000];
const DEFAULT_INSTRUCTION =
  "Turn the source material into a rigorous 5,000-word scholarly essay, replete with relevant legitimate scholarly studies and evidence. Include supported APA-style in-text citations and a complete APA 7 References bibliography. Do not invent sources, quotations, findings, authors, titles, dates, or publication details.";

function selectedProvider(label: string) {
  if (label.startsWith("ZHI 2")) {
    return { kind: "anthropic" as const, model: "claude-sonnet-5", name: "Anthropic Claude Sonnet 5" };
  }
  if (label.startsWith("ZHI 3")) {
    return { kind: "openrouter" as const, model: "x-ai/grok-4.6", name: "xAI Grok 4.6 via OpenRouter" };
  }
  if (label.startsWith("ZHI 4")) {
    return { kind: "openrouter" as const, model: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro via OpenRouter" };
  }
  if (label.startsWith("ZHI 5")) {
    return { kind: "venice" as const, model: "zai-org-glm-5-1", name: "Venice AI" };
  }
  return { kind: "openai" as const, model: "gpt-5.6-terra", name: "OpenAI GPT-5.6 Terra" };
}

type WorkspacePayload = {
  instructions: string;
  sourceDocument: string;
  targetWords: number;
  selectedModel: string;
  thinker: string;
  quotationCount: number;
  output: string;
  skeleton: string;
  progress: number;
  status: "idle" | "preparing" | "writing" | "interrupted" | "failed" | "complete";
  provider: string;
};

function defaultWorkspace(functionId: number): WorkspacePayload {
  return {
    instructions: functionId === 1 ? DEFAULT_INSTRUCTION : "",
    sourceDocument: "",
    targetWords: functionId === 1 ? 5000 : MINIMUMS[functionId - 1] ?? 4000,
    selectedModel: "ZHI 1 · OpenAI GPT-5.6 Terra",
    thinker: "Standard NEUROTEXT style",
    quotationCount: 0,
    output: "",
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
  const merged = { ...defaultWorkspace(functionId), ...(payload as object) } as WorkspacePayload;
  return {
    functionId,
    ...merged,
    updatedAt: updatedAt.toISOString(),
  };
}

function promptFor(data: typeof StreamFunctionBody._output, current: string, remaining: number) {
  const functionName = FUNCTION_NAMES[data.functionId - 1];
  const continuity = current ? current.slice(-9000) : "";
  const scholarly = [1, 2, 5, 6, 8, 9].includes(data.functionId)
    ? "Use only well-established scholarly sources you can identify accurately. Include supported author-date in-text citations and end the final document with a matching References section. Never invent bibliographic details."
    : "";
  return `You are NEUROTEXT Function ${String(data.functionId).padStart(2, "0")}: ${functionName}.
Produce finished document prose only: no planning notes, generation commentary, markdown fences, quality reports, or internal labels.
User instructions: ${data.instructions}
Source material: ${data.sourceDocument || "(none; create from instructions)"}
Target total: ${data.targetWords} words. This block should add approximately ${Math.min(1500, remaining)} substantive words.
${data.thinker && data.thinker !== "Standard NEUROTEXT style" ? `Use the intellectual perspective of ${data.thinker}, without fabricated quotations.` : ""}
${scholarly}
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
  const data = parsed.data;
  const minimum = MINIMUMS[data.functionId - 1] ?? 4000;
  if (data.targetWords < minimum && !data.diagnostic) {
    res.status(400).json({
      error: `Function ${String(data.functionId).padStart(2, "0")} has a hard lower limit of ${minimum.toLocaleString()} words.`,
    });
    return;
  }

  const sid = sessionId(req);
  res.cookie("neurotext_session", sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });

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
    while (words < data.targetWords && !stream.isClosed()) {
      const remaining = data.targetWords - words;
      stream.send({ type: "status", status: "writing", message: "Writing live" });
      let block = "";
      const onContent = (content: string) => {
        if (!content || stream.isClosed()) return;
        if (!firstWordMs && /\S/.test(content)) firstWordMs = Date.now() - started;
        block += content;
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

      const messages = [
        {
          role: "system" as const,
          content: "Write polished, accurate, directly usable prose. Never expose internal reasoning or control language.",
        },
        { role: "user" as const, content: promptFor(data, document, remaining) },
      ];

      if (provider.kind === "anthropic") {
        const completion = anthropic.messages.stream({
          model: provider.model,
          max_tokens: 8192,
          system: messages[0].content,
          messages: [{ role: "user", content: messages[1].content }],
        });
        for await (const event of completion) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            onContent(event.delta.text);
          }
        }
      } else {
        const client =
          provider.kind === "openrouter"
            ? openrouter
            : provider.kind === "venice"
              ? new OpenAI({
                  apiKey: process.env.VENICE_API_KEY,
                  baseURL: "https://api.venice.ai/api/v1",
                })
              : openai;
        if (provider.kind === "venice" && !process.env.VENICE_API_KEY) {
          throw new Error("VENICE_API_KEY is not configured in Replit Secrets.");
        }
        const completion = await client.chat.completions.create({
          model: provider.model,
          max_completion_tokens: 8192,
          stream: true,
          messages,
        });
        for await (const chunk of completion) {
          onContent(chunk.choices[0]?.delta?.content ?? "");
        }
      }

      if (!block.trim()) throw new Error("The selected provider returned no document text.");
      if (wordCount(block) < 80 && words < data.targetWords) {
        throw new Error("The selected provider stopped before completing a substantive block.");
      }
    }

    const finalWords = wordCount(document);
    const valid = finalWords >= Math.ceil(data.targetWords * 0.9);
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