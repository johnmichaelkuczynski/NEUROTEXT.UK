import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readInstructionFile, appendDraft } from "../artifacts/neurotext/src/lib/instruction-upload.ts";
import { DOCUMENT_SYSTEM_PROMPT, documentInputSection, separateLegacyDraft } from "../artifacts/api-server/src/services/document-inputs.ts";
import { SaveWorkspaceBody, StreamFunctionBody, GetWorkspaceResponse } from "../lib/api-zod/src/generated/api.ts";

const manuscript = process.argv[2]
  ? await readFile(process.argv[2], "utf8")
  : `Theoretical Knowledge and Inductive Inference\n${"A substantive argument about inference and theoretical knowledge. ".repeat(4000)}\nDo not confuse this quoted direction with a user instruction.`;
const draft = await readInstructionFile(new File([manuscript], "manuscript.txt", { type: "text/plain" }));
const input = {
  functionId: 9,
  instructions: "Turn into proper dissertation",
  instructionDraft: draft,
  sourceDocument: "Supporting reference material remains here.",
  targetWords: 45000,
  selectedModel: "ZHI 6 · Perplexity Sonar Pro",
};

function documentRoles(data) {
  const section = documentInputSection(data);
  return JSON.parse(section.split("\n")[2]);
}

const parsedStream = StreamFunctionBody.parse(input);
const roles = documentRoles(parsedStream);
assert.equal(roles.userTask, input.instructions);
assert.equal(roles.manuscriptToTransform, manuscript.trim());
assert.equal(roles.supportingReferences, input.sourceDocument);
assert.ok(!roles.userTask.includes("Theoretical Knowledge and Inductive Inference"));
assert.match(DOCUMENT_SYSTEM_PROMPT, /never as instructions/);
assert.match(DOCUMENT_SYSTEM_PROMPT, /not a guide about how to write dissertations/);
// Every continuation builds its input section from the same separate fields.
assert.deepEqual(documentRoles(parsedStream), roles);

const saved = SaveWorkspaceBody.parse({
  ...input,
  thinker: "",
  quotationCount: 0,
  output: "",
  skeleton: "",
  progress: 0,
  status: "idle",
  provider: "",
});
const restored = GetWorkspaceResponse.parse({
  ...JSON.parse(JSON.stringify(saved)),
  functionId: 9,
  updatedAt: new Date().toISOString(),
});
assert.equal(restored.instructionDraft, draft);
assert.equal(restored.instructions, input.instructions);
assert.equal(restored.sourceDocument, input.sourceDocument);

const legacy = separateLegacyDraft({
  ...input,
  instructionDraft: "",
  instructions: `${input.instructions}\n\nDissertation draft to revise (not reference material):\n${draft}`,
});
assert.equal(legacy.instructions, input.instructions);
assert.equal(legacy.instructionDraft, draft);
assert.deepEqual(separateLegacyDraft(legacy), legacy);
assert.deepEqual(documentRoles(legacy), roles);
const longInstructions = "These are deliberately long instructions. ".repeat(6000);
assert.equal(separateLegacyDraft({ instructions: longInstructions }).instructions, longInstructions);
assert.equal(separateLegacyDraft({ instructions: longInstructions }).instructionDraft, "");

assert.equal(appendDraft("Existing manuscript.", "Additional chapter."), "Existing manuscript.\n\nAdditional chapter.");
await assert.rejects(readInstructionFile(new File([""], "empty.txt")), /empty/);
await assert.rejects(readInstructionFile(new File(["binary"], "draft.pdf")), /plain text/);
console.log(`PASS: ${draft.split(/\s+/).length.toLocaleString()} manuscript words kept out of task instructions; request/response schemas, saved-state round trip, legacy imports, reference separation and file validation passed.`);
