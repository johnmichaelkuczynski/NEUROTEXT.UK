import assert from "node:assert/strict";
import test from "node:test";
import type { Response } from "express";
import { streamTranslation as streamCore } from "./translation-stream.ts";
import type { generateWithFallback, generateWithFallbackStreaming } from "./llm-router.ts";

// Exercise the actual stream coordinator through a response-shaped sink.
async function streamTranslation(
  res: Response,
  input: { functionId: string; text: string; instructions?: string; provider: string; translationTerminology?: { source: string; target: string }[] },
  models: {
    generate: typeof generateWithFallback;
    stream: typeof generateWithFallbackStreaming;
    terminologyWarning: (index: number) => void;
  },
) {
  await streamCore(
    { ...input, revision: input.functionId === "translation-revision" },
    models.stream,
    event => { res.write(`${JSON.stringify(event)}\n`); },
    () => res.destroyed || res.writableEnded,
    { extract: models.generate, warning: models.terminologyWarning },
  );
}

function response() {
  const events: Record<string, unknown>[] = [];
  const res = {
    destroyed: false, writableEnded: false,
    write(line: string) { events.push(JSON.parse(line)); return true; },
    flush() {},
  } as unknown as Response;
  return { res, events };
}

for (const failure of ["provider unavailable", "malformed JSON", "invalid entry"]) {
  test(`stream completes with its last valid map when extraction returns ${failure}`, async () => {
    const { res, events } = response();
    let sections = 0, extractions = 0, warnings = 0;
    await streamTranslation(res, {
      functionId: "translator", provider: "test",
      text: "Geist " + "x".repeat(3900) + " Geist " + "x".repeat(800),
    }, {
      stream: async (_provider, prompt, onToken) => {
        sections++;
        if (sections === 2) assert.match(prompt, /"source":"Geist","target":"spirit"/);
        const text = "spirit " + "accepted text ".repeat(160);
        await onToken(text, "test");
        return { text, providerUsed: "test" };
      },
      generate: async () => {
        extractions++;
        assert.ok(events.some(event => event.type === "token"), "no planning before first token");
        if (extractions === 1) return { text: '[{"source":"Geist","target":"spirit"}]', providerUsed: "test" };
        if (failure === "provider unavailable") throw new Error("unavailable");
        return { text: failure === "malformed JSON" ? "not JSON" : '[{"source":"Geist","target":null}]', providerUsed: "test" };
      },
      terminologyWarning: () => { warnings++; },
    });
    assert.equal(sections, 2);
    assert.equal(extractions, 3, "only extraction retries; accepted translation is never regenerated");
    assert.equal(warnings, 1);
    assert.equal(events.filter(event => event.type === "translation_terminology_warning").length, 1);
    assert.deepEqual(events.filter(event => event.type === "translation_terminology").at(-1)?.terms, [{ source: "Geist", target: "spirit" }]);
    assert.equal(events.at(-1)?.type, "done");
    assert.ok(!events.some(event => event.type === "error"));
  });
}

test("a malformed extraction can recover independently without a warning or replacement text", async () => {
  const { res, events } = response();
  let calls = 0;
  await streamTranslation(res, {
    functionId: "translation-revision", provider: "test", text: "spirit",
    translationTerminology: [{ source: "Geist", target: "spirit" }],
    instructions: "Change Geist to mind.",
  }, {
    stream: async (_provider, prompt, onToken) => {
      assert.match(prompt, /"source":"Geist","target":"spirit"/);
      await onToken("mind", "test");
      return { text: "mind", providerUsed: "test" };
    },
    generate: async () => ({ text: ++calls === 1 ? "bad JSON" : '[{"source":"Geist","target":"mind"}]', providerUsed: "test" }),
    terminologyWarning: () => assert.fail("retry should recover"),
  });
  assert.equal(calls, 2);
  assert.deepEqual(events.find(event => event.type === "translation_terminology")?.terms, [{ source: "Geist", target: "mind" }]);
  assert.equal(events.at(-1)?.type, "done");
  assert.ok(!events.some(event => event.type === "replace_output"));
});

test("fresh translations discard old maps and only accepted length retries establish terms", async () => {
  const { res, events } = response();
  let attempts = 0, extractions = 0;
  const rejected = "rejected ".repeat(35).trim();
  const accepted = "accepted ".repeat(20).trim();
  await streamTranslation(res, {
    functionId: "translator", provider: "test", text: "source ".repeat(40),
    instructions: "Shorten by 50%.", translationTerminology: [{ source: "old", target: "stale" }],
  }, {
    stream: async (_provider, prompt, onToken) => {
      assert.ok(!prompt.includes('"source":"old"'));
      const text = ++attempts === 1 ? rejected : accepted;
      await onToken(text, "test");
      return { text, providerUsed: "test" };
    },
    generate: async (_provider, prompt) => {
      extractions++;
      assert.ok(!prompt.includes(rejected));
      assert.ok(prompt.includes(accepted));
      return { text: "[]", providerUsed: "test" };
    },
    terminologyWarning: () => assert.fail("valid extraction"),
  });
  assert.equal(attempts, 2);
  assert.equal(extractions, 1);
  assert.equal(events.filter(event => event.type === "replace_output").length, 1);
  assert.equal(events.at(-1)?.type, "done");
});

test("a model cutoff preserves tokens and never learns terms or retries the incomplete part", async () => {
  const { res, events } = response();
  let calls = 0;
  await streamTranslation(res, {
    functionId: "translator", provider: "test", text: "Geist ".repeat(800),
    instructions: "Shorten by 50%.",
  }, {
    stream: async (_provider, _prompt, onToken) => {
      calls++;
      await onToken("partial spirit", "test");
      return { text: "partial spirit", providerUsed: "test", truncated: true, completion: "incomplete", finishReason: "length" };
    },
    generate: async () => assert.fail("incomplete text must not establish terminology"),
    terminologyWarning: () => assert.fail("cutoff must remain a translation error"),
  });
  assert.equal(calls, 1);
  assert.equal(events.find(event => event.type === "token")?.text, "partial spirit");
  assert.equal(events.at(-1)?.code, "translation_incomplete");
  assert.ok(!events.some(event => ["done", "section_done", "replace_output", "translation_terminology"].includes(String(event.type))));
});

test("truncated terminology JSON is not accepted even when syntactically valid", async () => {
  const { res, events } = response();
  let calls = 0;
  await streamTranslation(res, {
    functionId: "translation-revision", provider: "test", text: "spirit",
    translationTerminology: [{ source: "Geist", target: "spirit" }],
  }, {
    stream: async (_provider, _prompt, onToken) => {
      await onToken("mind", "test");
      return { text: "mind", providerUsed: "test", completion: "complete" };
    },
    generate: async () => {
      calls++;
      return { text: '[{"source":"Geist","target":"mind"}]', providerUsed: "test", truncated: true };
    },
    terminologyWarning: () => {},
  });
  assert.equal(calls, 2);
  assert.deepEqual(events.find(event => event.type === "translation_terminology")?.terms, [{ source: "Geist", target: "spirit" }]);
  assert.equal(events.at(-1)?.type, "done");
});
