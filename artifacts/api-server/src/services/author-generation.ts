import { authorFunction, authorReferenceMessage, buildAuthorPrompt, readPromptFields } from "./author-prompts.ts";
import { generateSelectedModel } from "./model-selection.ts";

export type AuthorRequest = {
  functionId: string;
  text: string;
  instructions?: string;
  targetWords?: string;
  provider: string;
  resumeDocument?: string;
  diagnosticPreview?: boolean;
};
export type AuthorEvent = Record<string, unknown>;
type ModelRequest = { systemPrompt: string; userMessage: string; temperature: number; maxTokens: number; provider: string; firstTextTimeoutMs?: number };
export type AuthorModel = (request: ModelRequest, token: (text: string, provider: string) => void) => Promise<{ text: string; providerUsed: string; truncated: boolean }>;

// This transport is isolated from legacy/Translator behavior. No hidden prompts,
// trimming, academic repair, automatic citations, or rewritten provider output.
export const authorModel: AuthorModel = async (request, token) => {
  return generateSelectedModel(request.provider, request.userMessage, token, {
    systemPrompt: request.systemPrompt,
    maxTokens: request.maxTokens,
    firstTextTimeoutMs: request.firstTextTimeoutMs,
  });
};

const CONTEXT_BYTES = 440_000;
export function splitAuthorSource(text: string, limit = CONTEXT_BYTES): string[] {
  if (Buffer.byteLength(text) <= limit) return [text];
  const chunks: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (bytes + size > limit && current) { chunks.push(current); current = ""; bytes = 0; }
    current += character;
    bytes += size;
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function generateAuthorDocument(
  input: AuthorRequest,
  emit: (event: AuthorEvent) => void,
  connected: () => boolean = () => true,
  model: AuthorModel = authorModel,
) {
  const fields = readPromptFields(input.instructions);
  if (input.functionId === "objections") {
    fields.instructions = [
      "Generate the strongest serious objections to the supplied document, explain why each matters, then produce a complete rewritten version that directly addresses them. Return the objections and the rewritten document, not a plan for writing them.",
      fields.instructions,
      input.targetWords ? `Target length for the entire response: ${input.targetWords} words.` : "",
    ].filter(Boolean).join("\n\n");
  }
  const fn = authorFunction(input.functionId, input.text, fields);
  if (!fn) return undefined;
  const preview = input.diagnosticPreview === true && ["thesis-creator", "thesis-transformer", "dissertation-creator", "dissertation-transformer"].includes(fn);
  let previewTruncated = false;
  const references = authorReferenceMessage({ ...fields, function: fn });
  const emptyPrompt = buildAuthorPrompt(fn, "", fields, input.targetWords);
  const overhead = Buffer.byteLength(emptyPrompt.systemPrompt + references);
  if (overhead >= CONTEXT_BYTES - 4000) throw new Error("Instructions and reference material exceed the model context. Shorten the reference material.");
  const chunks = splitAuthorSource(input.text, CONTEXT_BYTES - overhead);
  let summary = "";
  let output = input.resumeDocument ?? "";
  let providerUsed = "";
  // A resumed result is kept on screen by each caller, not emitted a second time.
  // Source chunk offsets cannot be guessed safely from generated output.
  if (input.resumeDocument && chunks.length > 1) throw new Error("Cannot resume a context-split document safely. Partial output is preserved; retry the request.");
  for (let index = 0; index < chunks.length && connected(); index++) {
    const prompt = buildAuthorPrompt(fn, chunks[index], fields, input.targetWords);
    let userMessage = references;
    if (chunks.length > 1) {
      // First establish the thesis from the opening, then carry and update that
      // summary with every chunk. This text is internal, never appended to output.
      const summarized = await model({
        ...prompt, provider: input.provider, maxTokens: 1000,
        userMessage: [references, summary ? `Document thesis so far:\n${summary}` : "", "For document continuity, return one paragraph summarizing the document's thesis and load-bearing distinctions in the supplied text."].filter(Boolean).join("\n\n"),
      }, () => {});
      if (summarized.truncated) throw new Error("Document thesis summary was interrupted.");
      summary = summarized.text;
      userMessage = [references, `Document thesis summary:\n${summary}`, `Document part ${index + 1} of ${chunks.length}.`].filter(Boolean).join("\n\n");
    }
    let partOutput = index === 0 ? input.resumeDocument ?? "" : "";
    for (let continuation = 0; continuation < 32 && connected(); continuation++) {
      const context = partOutput
        ? `Continue the interrupted output from its exact ending, without repeating existing text.\nCurrent output:\n${partOutput}`
        : "";
      if (Buffer.byteLength(prompt.systemPrompt + userMessage + context) > CONTEXT_BYTES + 150_000) {
        throw new Error("Continuation exceeds the model context. Partial output is preserved.");
      }
      const result = await model({
        ...prompt,
        provider: input.provider,
        maxTokens: preview ? 4096 : fn === "coherence" ? Math.min(32768, Math.max(4096, Math.ceil(Number(input.targetWords || 0) * 2))) : 32768,
        ...(fn === "coherence" ? { firstTextTimeoutMs: 90_000 } : {}),
        userMessage: [userMessage, context].filter(Boolean).join("\n\n"),
      }, (text, provider) => {
        output += text;
        partOutput += text;
        providerUsed = provider;
        emit({ type: "token", text, providerUsed: provider });
      });
      providerUsed = result.providerUsed;
      if (preview) { previewTruncated = result.truncated; break; }
      if (!result.truncated) break;
      if (continuation === 31) throw new Error("The model reached repeated output limits. Partial output is preserved.");
    }
    emit({ type: "section_done", index: index + 1, total: chunks.length });
    if (preview) break;
  }
  if (!connected()) throw new Error("Connection closed before generation finished.");
  emit({ type: "done", providerUsed, generatedWords: output.match(/\S+/g)?.length ?? 0, ...(preview ? { diagnosticPreview: true, truncated: previewTruncated } : {}) });
  return { text: output, providerUsed };
}
