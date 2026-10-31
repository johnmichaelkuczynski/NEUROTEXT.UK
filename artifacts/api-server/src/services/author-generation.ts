import { authorFunction, authorReferenceMessage, buildAuthorPrompt, readPromptFields } from "./author-prompts.ts";

export type AuthorRequest = {
  functionId: string;
  text: string;
  instructions?: string;
  targetWords?: string;
  provider: string;
  resumeDocument?: string;
};
export type AuthorEvent = Record<string, unknown>;
type ModelRequest = { systemPrompt: string; userMessage: string; temperature: number; maxTokens: number; provider: string };
export type AuthorModel = (request: ModelRequest, token: (text: string, provider: string) => void) => Promise<{ text: string; providerUsed: string; truncated: boolean }>;

// This transport is isolated from legacy/Translator behavior. No hidden prompts,
// trimming, academic repair, automatic citations, or rewritten provider output.
export const authorModel: AuthorModel = async (request, token) => {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const { anthropic } = await import("@workspace/integrations-anthropic-ai");
  // Both APIs require a nonempty conversational turn. With no optional reference
  // fields, repeat an existing canonical line rather than inventing instructions.
  const userMessage = request.userMessage || request.systemPrompt.split("\n")[0];
  const providers = request.provider === "ZHI 2" || request.provider === "ZHI 5"
    ? ["anthropic", "openai"] : ["openai", "anthropic"];
  let lastError: unknown;
  for (const provider of providers) {
    let visible = false;
    let text = "";
    let truncated = false;
    let finished = false;
    try {
      if (provider === "openai") {
        const stream = await openai.chat.completions.create({
          model: "gpt-5.6-terra",
          temperature: request.temperature,
          max_completion_tokens: request.maxTokens,
          stream: true,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: userMessage },
          ],
        });
        for await (const event of stream) {
          const choice = event.choices[0];
          if (choice?.finish_reason === "stop" || choice?.finish_reason === "length") finished = true;
          if (choice?.finish_reason === "length") truncated = true;
          const next = choice?.delta?.content ?? "";
          if (next) { visible = true; text += next; token(next, "OpenAI · GPT-5.6 Terra"); }
        }
      } else {
        const stream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          system: request.systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        });
        for await (const event of stream) {
          if (event.type === "message_stop") finished = true;
          if (event.type === "message_delta" && event.delta.stop_reason === "max_tokens") truncated = true;
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            const next = event.delta.text;
            visible = true; text += next; token(next, "Anthropic · Claude Sonnet 4.6");
          }
        }
      }
      if (!finished) throw new Error("The model stream ended without a completion signal.");
      if (!text.trim()) throw new Error("The model returned no text.");
      return { text, providerUsed: provider === "openai" ? "OpenAI · GPT-5.6 Terra" : "Anthropic · Claude Sonnet 4.6", truncated };
    } catch (error) {
      lastError = error;
      // Never silently combine a partial response with another provider's rewrite.
      if (visible) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No model completed the request.");
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
  const fn = authorFunction(input.functionId, input.text, fields);
  if (!fn) return undefined;
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
        maxTokens: 32768,
        userMessage: [userMessage, context].filter(Boolean).join("\n\n"),
      }, (text, provider) => {
        output += text;
        partOutput += text;
        providerUsed = provider;
        emit({ type: "token", text, providerUsed: provider });
      });
      providerUsed = result.providerUsed;
      if (!result.truncated) break;
      if (continuation === 31) throw new Error("The model reached repeated output limits. Partial output is preserved.");
    }
    emit({ type: "section_done", index: index + 1, total: chunks.length });
  }
  if (!connected()) throw new Error("Connection closed before generation finished.");
  emit({ type: "done", providerUsed, generatedWords: output.match(/\S+/g)?.length ?? 0 });
  return { text: output, providerUsed };
}
