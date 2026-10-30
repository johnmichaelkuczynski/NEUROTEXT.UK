import assert from "node:assert/strict";
import test from "node:test";
import { dissertationRequestError, isDissertationPage } from "./dissertation-limits.ts";
import { mastersThesisRequestError } from "./masters-thesis-limits.ts";

const base = { functionId: "dissertation-creator", targetWords: "45000", instructions: "A philosophical dissertation on collective action.", text: "" };

test("from-scratch dissertations accept the 45,000-word boundary without a source", () => {
  for (const targetWords of ["45000", "45,000", "20001", "1"]) {
    assert.equal(dissertationRequestError({ ...base, targetWords }), null);
  }
});

test("creation and critique reject missing, invalid, and excessive lengths", () => {
  for (const functionId of ["dissertation-creator", "dissertation-transformer", "dissertation-revision"]) {
    assert.equal(isDissertationPage(functionId), true);
    for (const targetWords of [undefined, "", "0", "-1", "1.5", "45k", "45001", "100000", "Infinity"]) {
      assert.match(dissertationRequestError({ ...base, functionId, text: "Current dissertation.", targetWords })!, /45,000/);
    }
  }
});

test("critique requires current output and instructions; recovery respects the cap", () => {
  assert.match(dissertationRequestError({ ...base, functionId: "dissertation-revision" })!, /Generate a dissertation/);
  assert.match(dissertationRequestError({ ...base, instructions: " " })!, /Describe/);
  assert.equal(dissertationRequestError({ ...base, functionId: "dissertation-revision", text: "Current dissertation." }), null);
  assert.equal(dissertationRequestError({ ...base, resumeDocument: "word ".repeat(45000) }), null);
  assert.match(dissertationRequestError({ ...base, resumeDocument: "word ".repeat(45001) })!, /saved dissertation/);
});

test("dissertation limits do not loosen thesis limits or change legacy functions", () => {
  assert.equal(mastersThesisRequestError(base), null);
  assert.match(mastersThesisRequestError({ ...base, functionId: "thesis-creator" })!, /20,000/);
  for (const functionId of ["thesis-creator", "thesis-transformer", "thesis-revision", "dissertation", "creator"]) {
    assert.equal(isDissertationPage(functionId), false);
    assert.equal(dissertationRequestError({ ...base, functionId, targetWords: undefined }), null);
  }
});

test("dissertation transformation requires source text and accepts 45,000 words", () => {
  assert.match(dissertationRequestError({ ...base, functionId: "dissertation-transformer" })!, /Paste or upload/);
  assert.match(dissertationRequestError({ ...base, functionId: "dissertation-transformer", text: " \n " })!, /Paste or upload/);
  assert.equal(dissertationRequestError({ ...base, functionId: "dissertation-transformer", text: "Original argument to develop into a dissertation." }), null);
});
