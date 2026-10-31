import assert from "node:assert/strict";
import test from "node:test";
import { SELECTABLE_MODELS, isSelectedModel, selectedModelRequest } from "./model-selection.ts";

test("the four opaque labels map in the author's specified order", () => {
  assert.deepEqual(SELECTABLE_MODELS, {
    "ZHI 1": { provider: "anthropic", model: "claude-opus-5-5" },
    "ZHI 2": { provider: "anthropic", model: "claude-sonnet-5-5" },
    "ZHI 3": { provider: "openai", model: "gpt-6.1-sol" },
    "ZHI 4": { provider: "anthropic", model: "claude-fable-5-1" },
  });
  assert.equal(isSelectedModel("ZHI 5"), false);
  assert.throws(() => selectedModelRequest("unavailable", "request"), /Choose ZHI/);
});

test("model selection preserves supplied prompts and omits unsupported sampling controls", () => {
  for (const alias of Object.keys(SELECTABLE_MODELS)) {
    const request = selectedModelRequest(alias, "", "Exact system.\nSecond line.", 1000);
    assert.equal(request.anthropic.system, "Exact system.\nSecond line.");
    assert.equal(request.openai.messages[0].role, "system");
    assert.equal(request.openai.messages[0].content, "Exact system.\nSecond line.");
    assert.ok(request.anthropic.messages[0].content.trim());
    for (const body of [request.openai, request.anthropic]) {
      assert.ok(!("temperature" in body));
      assert.ok(!("top_p" in body));
      assert.ok(!("top_k" in body));
    }
  }
});

test("translation and legacy user prompts are sent unchanged without adding a system prompt", () => {
  const text = "Translate literally.\n  Source {TEXT} $&  ";
  const request = selectedModelRequest("ZHI 3", text);
  assert.equal(request.openai.messages.length, 1);
  assert.equal(request.openai.messages[0].content, text);
  assert.equal(request.anthropic.messages[0].content, text);
  assert.ok(!("system" in request.anthropic));
});
