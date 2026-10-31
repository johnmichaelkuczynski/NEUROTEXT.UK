import assert from "node:assert/strict";
import test from "node:test";
import { generateAuthorDocument, splitAuthorSource, type AuthorModel, type AuthorEvent } from "./author-generation.ts";
import { CORE_RULES } from "./author-prompts.ts";
import { readFileSync } from "node:fs";

test("provider transport has exact system roles and temperatures with nonblank conversational turns", () => {
  const source = readFileSync(new URL("./author-generation.ts", import.meta.url), "utf8");
  assert.match(source, /role: "system", content: request\.systemPrompt/);
  assert.match(source, /system: request\.systemPrompt/);
  assert.equal((source.match(/temperature: request\.temperature/g) ?? []).length, 2);
  assert.match(source, /request\.userMessage \|\| request\.systemPrompt\.split\("\\n"\)\[0\]/);
  assert.ok(!source.includes('content: request.userMessage || " "'));
});

test("a full document goes in one request and native output is unchanged", async () => {
  const source = "SOURCE\n\n".repeat(8000); // far beyond the old 500-word chunks
  const received: Parameters<AuthorModel>[0][] = [];
  const events: AuthorEvent[] = [];
  const exact = "  No added header.\nCONFLICT_FLAG: keep this.\n\n";
  const model: AuthorModel = async (request, emit) => {
    received.push(request);
    emit(exact, "test");
    return { text: exact, providerUsed: "test", truncated: false };
  };
  const result = await generateAuthorDocument({ functionId: "manipulator", text: source, instructions: "Fix spelling.", provider: "ZHI 1" }, (event) => events.push(event), () => true, model);
  assert.equal(received.length, 1);
  assert.ok(received[0].systemPrompt.startsWith(CORE_RULES));
  assert.ok(received[0].systemPrompt.endsWith(source));
  assert.equal(received[0].temperature, 0.2);
  assert.equal(result?.text, exact);
  assert.equal(events.filter((event) => event.type === "token").map((event) => event.text).join(""), exact);
  assert.equal(events.at(-1)?.type, "done");
});

test("output-limit continuation retains the identical system prompt and exact token concatenation", async () => {
  const requests: Parameters<AuthorModel>[0][] = [];
  const model: AuthorModel = async (request, emit) => {
    requests.push(request);
    const text = requests.length === 1 ? "First" : " second.\n";
    emit(text, "test");
    return { text, providerUsed: "test", truncated: requests.length === 1 };
  };
  const result = await generateAuthorDocument({ functionId: "creator", text: "", instructions: JSON.stringify({ authorPrompt: 1, topic: "Story" }), provider: "ZHI 1" }, () => {}, () => true, model);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].systemPrompt, requests[1].systemPrompt);
  assert.match(requests[1].userMessage, /First/);
  assert.equal(result?.text, "First second.\n");
});

test("unavoidable input chunking preserves Unicode and carries a thesis summary to each chunk", async () => {
  assert.deepEqual(splitAuthorSource("😀😀ab", 5), ["😀", "😀a", "b"]);
  const source = "Premise. ".repeat(65000);
  const calls: Parameters<AuthorModel>[0][] = [];
  const model: AuthorModel = async (request, emit) => {
    calls.push(request);
    if (request.userMessage.includes("For document continuity")) return { text: "The thesis is P.", providerUsed: "test", truncated: false };
    emit("X", "test");
    return { text: "X", providerUsed: "test", truncated: false };
  };
  const result = await generateAuthorDocument({ functionId: "manipulator", text: source, provider: "ZHI 1" }, () => {}, () => true, model);
  const outputCalls = calls.filter((call) => !call.userMessage.includes("For document continuity"));
  assert.equal(outputCalls.length, 2);
  assert.ok(outputCalls.every((call) => call.userMessage.includes("Document thesis summary:\nThe thesis is P.")));
  assert.equal(result?.text, "XX");
});

test("a failed stream never reports completion and Translator never enters this transport", async () => {
  const events: AuthorEvent[] = [];
  const model: AuthorModel = async (_, emit) => { emit("partial", "test"); throw new Error("interrupted"); };
  await assert.rejects(generateAuthorDocument({ functionId: "maxintel", text: "input", provider: "ZHI 1" }, (event) => events.push(event), () => true, model), /interrupted/);
  assert.ok(!events.some((event) => event.type === "done"));
  assert.equal(await generateAuthorDocument({ functionId: "translator", text: "input", provider: "ZHI 1" }, () => {}, () => true, model), undefined);
});
