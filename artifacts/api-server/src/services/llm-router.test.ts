import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { streamTranslation } from "./translation-stream.ts";

// No model calls or credentials: replay the providers' native stream shapes.
let openaiParts: unknown[] = [];
let anthropicParts: unknown[] = [];
let failOpenai = false;
let failAnthropic = false;
let openaiCalls = 0;
let onOpenaiNext: (() => void) | undefined;

mock.module("@workspace/integrations-openai-ai-server", {
  namedExports: {
    openai: { chat: { completions: { create: async ({ stream }: { stream?: boolean }) => {
      openaiCalls++;
      if (!stream) return { choices: [{ message: { content: "Hello." }, finish_reason: "length" }] };
      return {
        controller: { abort() {} },
        async *[Symbol.asyncIterator]() {
          for (const part of openaiParts) { onOpenaiNext?.(); yield part; }
          if (failOpenai) throw new Error("Disconnected");
        },
      };
    } } } },
  },
});
mock.module("@workspace/integrations-anthropic-ai", {
  namedExports: {
    anthropic: { messages: {
      create: async () => ({ content: [{ type: "text", text: "Hello." }], stop_reason: "end_turn" }),
      stream: () => ({
        abort() {},
        async *[Symbol.asyncIterator]() {
          for (const part of anthropicParts) yield part;
          if (failAnthropic) throw new Error("Disconnected");
        },
      }),
    } },
  },
});

const { generateWithFallback, generateWithFallbackStreaming } = await import("./llm-router.ts");

function openaiResponse(reason: string | null) {
  openaiParts = [
    { choices: [{ delta: { content: "Hello" }, finish_reason: null }] },
    { choices: [{ delta: { content: "." }, finish_reason: null }] },
    // Finish reasons normally arrive on a chunk with no visible text.
    { choices: [{ delta: {}, finish_reason: reason }] },
    { choices: [], usage: { completion_tokens: 2 } },
  ];
  failOpenai = false;
  openaiCalls = 0;
}

test("OpenAI preserves native token timing and reports normal completion", async () => {
  openaiResponse("stop");
  const tokens: string[] = [];
  let advances = 0;
  onOpenaiNext = () => {
    advances++;
    if (advances === 2) assert.deepEqual(tokens, ["Hello"], "first token forwarded before reading the next");
  };
  try {
    const result = await generateWithFallbackStreaming("ZHI 6", "Translate", token => { tokens.push(token); }, { paceMs: 0 });
    assert.deepEqual(tokens, ["Hello", "."]);
    assert.equal(result.text, "Hello.");
    assert.equal(result.finishReason, "stop");
    assert.equal(result.completion, "complete");
    assert.equal(result.truncated, false);
  } finally {
    onOpenaiNext = undefined;
  }
});

test("OpenAI output limit is exposed even on a tokenless final chunk", async () => {
  openaiResponse("length");
  const result = await generateWithFallbackStreaming("ZHI 6", "Translate", () => {}, { paceMs: 0 });
  assert.equal(result.text, "Hello.");
  assert.equal(result.finishReason, "length");
  assert.equal(result.truncated, true);
  assert.equal(result.completion, "incomplete");
});

test("Anthropic reports end_turn and max_tokens without changing tokens", async () => {
  for (const reason of ["end_turn", "max_tokens", "model_context_window_exceeded"]) {
    anthropicParts = [
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hello." } },
      { type: "message_delta", delta: { stop_reason: reason } },
      { type: "message_stop" },
    ];
    const tokens: string[] = [];
    const result = await generateWithFallbackStreaming("ZHI 5", "Translate", token => { tokens.push(token); }, { paceMs: 0 });
    assert.deepEqual(tokens, ["Hello."]);
    assert.equal(result.finishReason, reason);
    assert.equal(result.completion, reason === "end_turn" ? "complete" : "incomplete");
    assert.equal(result.truncated, reason !== "end_turn");
  }
});

test("missing finish metadata stays optional and does not invent completion", async () => {
  openaiResponse(null);
  const result = await generateWithFallbackStreaming("ZHI 6", "Translate", () => {});
  assert.equal(result.finishReason, undefined);
  assert.equal(result.completion, undefined);
  assert.equal(result.truncated, undefined);
  assert.equal(result.text, "Hello.");
});

test("non-streaming callers also receive optional finish metadata", async () => {
  const openai = await generateWithFallback("ZHI 6", "Translate");
  assert.equal(openai.truncated, true);
  const anthropic = await generateWithFallback("ZHI 5", "Translate");
  assert.equal(anthropic.completion, "complete");
});

async function translate(text: string, instructions?: string, revision = false) {
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  await streamTranslation(
    { text, instructions, revision, provider: "ZHI 6" },
    generateWithFallbackStreaming,
    event => { events.push(event); },
    () => false,
  );
  return events;
}

test("normal translation completes every source part then emits done", async () => {
  openaiResponse("stop");
  const events = await translate("Bonjour. ".repeat(700));
  assert.equal(openaiCalls, 2);
  assert.equal(events.filter(e => e.type === "section_done").length, 2);
  assert.equal(events.at(-1)?.type, "done");
  assert.equal(events.some(e => e.type === "error"), false);
});

test("forced output limit preserves tokens and never completes or retries the partial part", async () => {
  for (const revision of [false, true]) {
    openaiResponse("length");
    const events = await translate("Bonjour. ".repeat(700), "Cut length in half.", revision);
    assert.equal(openaiCalls, 1, "no length retry or next-part request after truncation");
    assert.equal(events.filter(e => e.type === "token").map(e => e.text).join(""), "Hello.");
    assert.equal(events.some(e => ["done", "section_done", "replace_output"].includes(e.type)), false);
    assert.equal(events.at(-1)?.code, "translation_incomplete");
    assert.equal(events.at(-1)?.finishReason, "length");
    assert.match(String(events.at(-1)?.message), /output limit.*partial text is preserved/i);
  }
});

test("a later cutoff retains earlier complete parts without falsely completing the document", async () => {
  openaiResponse("stop");
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  await streamTranslation(
    { text: "Bonjour. ".repeat(700), provider: "ZHI 6", revision: false },
    async (...args) => {
      if (openaiCalls === 1) openaiResponse("length");
      return generateWithFallbackStreaming(...args);
    },
    event => { events.push(event); },
    () => false,
  );
  assert.equal(events.filter(e => e.type === "section_done").length, 1);
  assert.equal(events.filter(e => e.type === "token").map(e => e.text).join(""), "Hello.Hello.");
  assert.equal(events.at(-1)?.type, "error");
  assert.equal(events.some(e => ["done", "replace_output"].includes(e.type)), false);
});

test("interrupted fallback exhaustion is incomplete, not a successful partial translation", async () => {
  openaiResponse(null);
  failOpenai = true;
  anthropicParts = [];
  failAnthropic = true;
  try {
    const events = await translate("Bonjour.");
    assert.equal(events.at(-1)?.finishReason, "stream_error");
    assert.equal(events.at(-1)?.type, "error");
    assert.equal(events.some(e => e.type === "done"), false);
    assert.equal(events.filter(e => e.type === "token").map(e => e.text).join(""), "Hello.");
  } finally {
    failOpenai = false;
    failAnthropic = false;
  }
});

test("a provider refusal is not accepted as a completed translation", async () => {
  openaiResponse("content_filter");
  const events = await translate("Bonjour.");
  assert.equal(events.at(-1)?.type, "error");
  assert.equal(events.some(e => e.type === "done"), false);
});

test("current selected models preserve aliases and completion metadata without fallback", async () => {
  for (const reason of ["stop", "length"]) {
    openaiResponse(reason);
    const events: Array<{ type: string; [key: string]: unknown }> = [];
    await streamTranslation(
      { text: "Bonjour.", provider: "ZHI 3", revision: false },
      generateWithFallbackStreaming,
      event => { events.push(event); },
      () => false,
    );
    assert.equal(openaiCalls, 1);
    assert.ok(events.filter(e => e.type === "token").every(e => e.providerUsed === "ZHI 3"));
    assert.equal(events.at(-1)?.type, reason === "stop" ? "done" : "error");
    if (reason === "length") assert.equal(events.at(-1)?.finishReason, "length");
  }
  for (const reason of ["end_turn", "max_tokens"]) {
    anthropicParts = [
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hello." } },
      { type: "message_delta", delta: { stop_reason: reason } },
      { type: "message_stop" },
    ];
    const result = await generateWithFallbackStreaming("ZHI 1", "Translate", () => {});
    assert.equal(result.providerUsed, "ZHI 1");
    assert.equal(result.finishReason, reason);
    assert.equal(result.completion, reason === "end_turn" ? "complete" : "incomplete");
  }
});
