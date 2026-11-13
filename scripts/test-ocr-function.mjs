import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { mergeOcrDestination } from "../artifacts/neurotext/src/lib/ocr-state.ts";
const require = createRequire(resolve("artifacts/api-server/package.json"));
const guest = { functionId:10, instructions:"Keep assignment", output:"Keep prior answer", sourceDocument:"Old reference", thinker:"Keep style", targetWords:500 };
const blankServer = { functionId:10, instructions:"", output:"", sourceDocument:"Old reference\n\nNew OCR", thinker:"", targetWords:100, updatedAt:"now" };
const merged = mergeOcrDestination(blankServer, guest);
assert.equal(merged.instructions,guest.instructions);
assert.equal(merged.output,guest.output);
assert.equal(merged.thinker,guest.thinker);
assert.equal(merged.targetWords,guest.targetWords);
assert.equal(merged.sourceDocument,blankServer.sourceDocument);
const { build } = require("esbuild");
const bundle = await build({
  entryPoints: ["artifacts/api-server/src/services/specialist-ocr.ts"],
  bundle: true, write: false, format: "cjs", platform: "node",
});
const module = { exports: {} };
new Function("require","module","exports",bundle.outputFiles[0].text)(require,module,module.exports);
const { extractSpecialistImage, SPECIALIST_OCR_PROMPT } = module.exports;
assert.match(SPECIALIST_OCR_PROMPT,/Do not translate/);
assert.match(SPECIALIST_OCR_PROMPT,/uncertain/);
assert.match(SPECIALIST_OCR_PROMPT,/Do not invent/);
assert.match(SPECIALIST_OCR_PROMPT,/untrusted data/);
const originalFetch = globalThis.fetch;
try {
  let payload = { text: String.raw`𓀀 [uncertain: damaged sign] \(F=ma\)`, warnings:["Damaged sign cannot be identified."] };
  let finish = "stop";
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).startsWith("https://api.openai.com/v1/"));
    const request = JSON.parse(init.body);
    assert.equal(request.max_completion_tokens,8192);
    assert.equal(request.response_format.json_schema.strict,true);
    assert.equal(request.messages[1].content[1].type,"image_url");
    return Response.json({ id:"test",object:"chat.completion",created:1,model:"test",choices:[{index:0,finish_reason:finish,message:{role:"assistant",content:JSON.stringify(payload)}}] });
  };
  const result = await extractSpecialistImage(Buffer.from("image"),"image/png","Egyptian signs, transcription only");
  assert.equal(result.text,payload.text);
  assert.ok(result.warnings[0].includes("not an authoritative decipherment"));
  assert.equal(result.warnings[1],payload.warnings[0]);
  finish="length";
  await assert.rejects(extractSpecialistImage(Buffer.from("image"),"image/png"),/could not be completed/);
  finish="stop"; payload={text:"",warnings:[]};
  await assert.rejects(extractSpecialistImage(Buffer.from("image"),"image/png"),/readable transcription/);
  globalThis.fetch = async () => Response.json({error:{message:"Invalid key",type:"authentication_error"}},{status:401});
  await assert.rejects(extractSpecialistImage(Buffer.from("image"),"image/png"),/rejected the specialist OCR credentials/);
} finally { globalThis.fetch = originalFetch; }
const api = readFileSync("artifacts/api-server/src/routes/neurotext.ts","utf8");
assert.ok(api.includes('"OCR"'));
assert.match(api,/length: 11/g);
const dashboard=readFileSync("artifacts/neurotext/src/pages/Dashboard.tsx","utf8");
assert.ok(dashboard.includes("11: 'OCR'"));
assert.ok(dashboard.includes("selectedFunctionId === 11"));
const spec=readFileSync("lib/api-spec/openapi.yaml","utf8");
assert.ok(spec.includes("enum: [mathpix, specialist]"));
assert.ok(spec.includes("enum: [Mathpix, OpenAI]"));
console.log("PASS: Function 11 wiring, specialist Unicode/LaTeX transcription, explicit uncertainty, strict JSON, incomplete/empty-result rejection and provider errors. Provider calls were mocked.");
