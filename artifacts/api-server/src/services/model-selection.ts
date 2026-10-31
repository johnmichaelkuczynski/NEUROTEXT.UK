export const SELECTABLE_MODELS = {
  "ZHI 1": { provider: "anthropic", model: "claude-opus-5-5" },
  "ZHI 2": { provider: "anthropic", model: "claude-sonnet-5-5" },
  "ZHI 3": { provider: "openai", model: "gpt-6.1-sol" },
  "ZHI 4": { provider: "anthropic", model: "claude-fable-5-1" },
} as const;

export type SelectedModel = keyof typeof SELECTABLE_MODELS;

export function isSelectedModel(value: string): value is SelectedModel {
  return Object.hasOwn(SELECTABLE_MODELS, value);
}

export function selectedModelRequest(provider: string, prompt: string, systemPrompt?: string, maxTokens = 32768) {
  if (!isSelectedModel(provider)) throw new Error("Choose ZHI 1, ZHI 2, ZHI 3, or ZHI 4.");
  const selection = SELECTABLE_MODELS[provider];
  const userMessage = prompt || systemPrompt?.split("\n")[0] || "";
  if (!userMessage.trim()) throw new Error("Enter a writing request.");
  // These model generations restrict sampling controls. Do not send the older
  // temperature/top_p/top_k settings, and never substitute a different model.
  return {
    selection,
    openai: {
      model: selection.model,
      max_completion_tokens: maxTokens,
      stream: true as const,
      messages: [
        ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
        { role: "user" as const, content: userMessage },
      ],
    },
    anthropic: {
      model: selection.model,
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user" as const, content: userMessage }],
    },
  };
}

export async function generateSelectedModel(
  provider: string,
  prompt: string,
  onToken: (text: string, providerUsed: string) => Promise<void> | void,
  options: { systemPrompt?: string; maxTokens?: number } = {},
) {
  const request = selectedModelRequest(provider, prompt, options.systemPrompt, options.maxTokens);
  let text = "";
  let truncated = false;
  let finished = false;
  let finishReason: string | undefined;
  if (request.selection.provider === "openai") {
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const stream = await openai.chat.completions.create(request.openai);
    for await (const event of stream) {
      const choice = event.choices[0];
      finishReason = choice?.finish_reason ?? finishReason;
      if (choice?.finish_reason === "stop" || choice?.finish_reason === "length") finished = true;
      if (choice?.finish_reason === "length") truncated = true;
      const next = choice?.delta?.content ?? "";
      if (next) { text += next; await onToken(next, provider); }
    }
  } else {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    const stream = anthropic.messages.stream(request.anthropic);
    for await (const event of stream) {
      if (event.type === "message_delta") finishReason = event.delta.stop_reason ?? finishReason;
      if (event.type === "message_stop") finished = true;
      if (event.type === "message_delta" && event.delta.stop_reason === "max_tokens") truncated = true;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        await onToken(event.delta.text, provider);
      }
    }
  }
  if (!finished) throw new Error(`${provider} ended without a completion signal. Partial output is preserved.`);
  if (!text.trim()) throw new Error(`${provider} returned no text.`);
  return { text, providerUsed: provider, truncated, finishReason };
}
