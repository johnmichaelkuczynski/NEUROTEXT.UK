import { anthropic } from "@workspace/integrations-anthropic-ai";
import { openai } from "@workspace/integrations-openai-ai-server";

export type ProviderId =
  | "GENIUS · Kuczynski"
  | "ZHI 1"
  | "ZHI 2"
  | "ZHI 3"
  | "ZHI 4"
  | "ZHI 5"
  | "ZHI 6";

const providerChains: Record<ProviderId, Array<"genius" | "openai" | "anthropic">> = {
  "GENIUS · Kuczynski": ["genius", "openai", "anthropic"],
  "ZHI 1": ["openai", "anthropic"],
  "ZHI 2": ["anthropic", "openai"],
  "ZHI 3": ["openai", "anthropic"],
  "ZHI 4": ["openai", "anthropic"],
  "ZHI 5": ["anthropic", "openai"],
  "ZHI 6": ["openai", "anthropic"],
};

const geniusEndpoint = "https://genius101.xyz/api/external/kuczynski";

export type GenerationOptions = {
  maxWords?: number;
  quotes?: number;
  allowFallback?: boolean;
  paceMs?: number;
};

const providerDisplayNames = {
  genius: "GENIUS 101 · Kuczynski",
  openai: "OpenAI · GPT-5.6 Terra",
  anthropic: "Anthropic · Claude Sonnet 4.6",
} as const;

const CONNECT_MS = 3500;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string, onTimeout?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        onTimeout?.();
        reject(new Error(`${label} timed out after ${ms} ms`));
      },
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function forwardVisibleText(
  token: string,
  providerUsed: string,
  onToken: (token: string, providerUsed: string) => Promise<void> | void,
  paceMs: number,
) {
  const pieces = token.length > 80 ? token.match(/\S+\s*/g) ?? [token] : [token];
  for (const piece of pieces) {
    await onToken(piece, providerUsed);
    if (pieces.length > 1 && paceMs > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
  }
}

async function geniusRequest(prompt: string, options: GenerationOptions = {}, stream: boolean) {
  const key = process.env.GENIUS_API_KEY;
  if (!key) throw new Error("GENIUS_API_KEY is not configured.");
  const maxWords = options.maxWords ?? 5000;
  const quotes = Math.round(options.quotes ?? 3);
  return fetch(geniusEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: stream ? "text/event-stream" : "application/json",
    },
    body: JSON.stringify({
      message: prompt,
      history: [],
      maxWords: Math.max(50, Math.min(5000, maxWords)),
      quotes: Math.max(0, Math.min(20, quotes)),
      stream,
    }),
  });
}

export async function generateWithFallback(
  requestedProvider: string,
  prompt: string,
  options: GenerationOptions = {},
): Promise<{ text: string; providerUsed: string }> {
  const provider = (providerChains[requestedProvider as ProviderId]
    ? requestedProvider
    : "ZHI 1") as ProviderId;
  let lastError: unknown;
  const candidates = options.allowFallback === false
    ? providerChains[provider].slice(0, 1)
    : providerChains[provider];
  for (const candidate of candidates) {
    try {
      if (candidate === "genius") {
        const response = await withTimeout(
          geniusRequest(prompt, options, false),
          CONNECT_MS,
          "Genius connect",
        );
        if (!response.ok) throw new Error(`Genius request failed with status ${response.status}.`);
        const body = (await response.json()) as { response?: string };
        if (body.response?.trim()) return { text: body.response.trim(), providerUsed: providerDisplayNames.genius };
      } else if (candidate === "openai") {
        const response = await withTimeout(
          openai.chat.completions.create({
            model: "gpt-5.6-terra",
            max_completion_tokens: options.maxWords ? Math.max(256, Math.ceil(options.maxWords * 1.6)) : 8192,
            messages: [{ role: "user", content: prompt }],
          }),
          CONNECT_MS,
          "OpenAI connect",
        );
        const text = response.choices[0]?.message?.content?.trim();
        if (text) return { text, providerUsed: providerDisplayNames.openai };
      } else {
        const response = await withTimeout(
          anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: options.maxWords ? Math.max(256, Math.ceil(options.maxWords * 1.6)) : 8192,
            messages: [{ role: "user", content: prompt }],
          }),
          CONNECT_MS,
          "Anthropic connect",
        );
        const text = response.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("")
          .trim();
        if (text) return { text, providerUsed: providerDisplayNames.anthropic };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No available language model completed the request.");
}

export async function generateWithFallbackStreaming(
  requestedProvider: string,
  prompt: string,
  onToken: (token: string, providerUsed: string) => Promise<void> | void,
  options: GenerationOptions = {},
): Promise<{ text: string; providerUsed: string }> {
  const provider = (providerChains[requestedProvider as ProviderId]
    ? requestedProvider
    : "ZHI 1") as ProviderId;
  let lastError: unknown;
  const candidates = options.allowFallback === false
    ? providerChains[provider].slice(0, 1)
    : providerChains[provider];
  let retainedText = "";
  let lastProviderUsed = providerDisplayNames[candidates[0]];
  for (const candidate of candidates) {
    let emitted = false;
    let candidateText = "";
    const candidatePrompt = retainedText
      ? `${prompt}

The previous provider stopped after writing this partial response:
${retainedText}

Continue from the exact final sentence. Do not repeat any existing text. Return only the continuation needed to complete the original request.`
      : prompt;
    const firstVisibleDeadline = Date.now() + CONNECT_MS;
    const firstVisibleRemaining = () => Math.max(1, firstVisibleDeadline - Date.now());
    try {
      let text = "";
      if (candidate === "genius") {
        const response = await withTimeout(
          geniusRequest(candidatePrompt, options, true),
          CONNECT_MS,
          "Genius connect",
        );
        if (!response.ok || !response.body) throw new Error(`Genius stream failed with status ${response.status}.`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullResponse = "";
        while (true) {
          const { value, done } = emitted
            ? await reader.read()
            : await withTimeout(reader.read(), firstVisibleRemaining(), "Genius first visible text", () => { void reader.cancel(); });
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;
            const body = JSON.parse(raw) as { response?: string; text?: string; delta?: string; content?: string; done?: boolean };
            if (body.done) continue;
            const next = body.delta ?? body.text ?? body.content ?? body.response ?? "";
            if (!next) continue;
            const token = body.response?.startsWith(fullResponse)
              ? body.response.slice(fullResponse.length)
              : next;
            fullResponse += token;
            candidateText = fullResponse;
            if (!token) continue;
            emitted = true;
            await forwardVisibleText(token, providerDisplayNames.genius, onToken, options.paceMs ?? 8);
          }
          if (done) break;
        }
        if (fullResponse.trim()) {
          return {
            text: `${retainedText}${retainedText ? " " : ""}${fullResponse}`.trim(),
            providerUsed: providerDisplayNames.genius,
          };
        }
      } else if (candidate === "openai") {
        const stream = await withTimeout(
          openai.chat.completions.create({
            model: "gpt-5.6-terra",
            max_completion_tokens: options.maxWords ? Math.max(256, Math.ceil(options.maxWords * 1.6)) : 8192,
            stream: true,
            messages: [{ role: "user", content: candidatePrompt }],
          }),
          CONNECT_MS,
          "OpenAI connect",
        );
        const iterator = stream[Symbol.asyncIterator]();
        while (true) {
          const partResult = emitted
            ? await iterator.next()
            : await withTimeout(iterator.next(), firstVisibleRemaining(), "OpenAI first visible text", () => stream.controller.abort());
          if (partResult.done) break;
          const part = partResult.value;
          const token = part.choices[0]?.delta?.content ?? "";
          if (!token) continue;
          emitted = true;
          text += token;
          candidateText = text;
          await forwardVisibleText(token, providerDisplayNames.openai, onToken, options.paceMs ?? 8);
        }
        if (text.trim()) {
          return {
            text: `${retainedText}${retainedText ? " " : ""}${text}`.trim(),
            providerUsed: providerDisplayNames.openai,
          };
        }
      } else {
        const stream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: options.maxWords ? Math.max(256, Math.ceil(options.maxWords * 1.6)) : 8192,
          messages: [{ role: "user", content: candidatePrompt }],
        });
        const iterator = stream[Symbol.asyncIterator]();
        const consume = async (event: Awaited<ReturnType<typeof iterator.next>>["value"]) => {
          if (!event || event.type !== "content_block_delta" || event.delta.type !== "text_delta") return;
          const token = event.delta.text;
          if (!token) return;
          emitted = true;
          text += token;
          candidateText = text;
          await forwardVisibleText(token, providerDisplayNames.anthropic, onToken, options.paceMs ?? 8);
        };
        while (true) {
          const eventResult = emitted
            ? await iterator.next()
            : await withTimeout(iterator.next(), firstVisibleRemaining(), "Anthropic first visible text", () => stream.abort());
          if (eventResult.done) break;
          await consume(eventResult.value);
        }
        if (text.trim()) {
          return {
            text: `${retainedText}${retainedText ? " " : ""}${text}`.trim(),
            providerUsed: providerDisplayNames.anthropic,
          };
        }
      }
    } catch (error) {
      lastError = error;
      if (emitted && candidateText.trim()) {
        retainedText = `${retainedText}${retainedText ? " " : ""}${candidateText}`.trim();
        lastProviderUsed = providerDisplayNames[candidate];
      }
    }
  }
  if (retainedText) {
    return { text: retainedText, providerUsed: lastProviderUsed };
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No available language model completed the streaming request.");
}