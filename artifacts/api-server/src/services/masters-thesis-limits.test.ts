import assert from "node:assert/strict";
import test from "node:test";
import { isMastersThesisPage, mastersThesisRequestError } from "./masters-thesis-limits.ts";

const base = { functionId: "thesis-creator", targetWords: "20000", instructions: "A conceptual thesis about collective action.", text: "" };

test("from-scratch thesis accepts the 20,000-word boundary without a source document", () => {
  assert.equal(mastersThesisRequestError(base), null);
  assert.equal(mastersThesisRequestError({ ...base, targetWords: "20,000" }), null);
  assert.equal(mastersThesisRequestError({ ...base, targetWords: "1" }), null);
});

test("thesis creation and revisions reject missing, invalid, and over-limit lengths", () => {
  for (const functionId of ["thesis-creator", "thesis-transformer", "thesis-revision"]) {
    for (const targetWords of [undefined, "", "0", "-1", "2.5", "20k", "20001", "100000", "Infinity"]) {
      assert.match(mastersThesisRequestError({ ...base, functionId, targetWords, text: "Existing thesis." })!, /20,000/);
    }
  }
});

test("revision requires an existing output and rejects over-limit resume content", () => {
  assert.match(mastersThesisRequestError({ ...base, functionId: "thesis-revision" })!, /before requesting/);
  assert.equal(mastersThesisRequestError({ ...base, functionId: "thesis-revision", text: "Existing thesis." }), null);
  assert.match(mastersThesisRequestError({ ...base, resumeDocument: "word ".repeat(20001) })!, /exceeds/);
  assert.equal(mastersThesisRequestError({ ...base, resumeDocument: "word ".repeat(20000) }), null);
});

test("thesis transformation requires supplied text and accepts the 20,000-word boundary", () => {
  assert.match(mastersThesisRequestError({ ...base, functionId: "thesis-transformer" })!, /Paste or upload/);
  assert.match(mastersThesisRequestError({ ...base, functionId: "thesis-transformer", text: "  \n " })!, /Paste or upload/);
  assert.equal(mastersThesisRequestError({ ...base, functionId: "thesis-transformer", text: "The actual text to develop into a thesis." }), null);
  assert.equal(isMastersThesisPage("thesis-transformer"), true);
});

test("new thesis-page limits do not change existing writing functions", () => {
  for (const functionId of ["creator", "manipulator", "thesis", "dissertation", "profile"]) {
    assert.equal(isMastersThesisPage(functionId), false);
    assert.equal(mastersThesisRequestError({ ...base, functionId, targetWords: "50000" }), null);
  }
  assert.equal(isMastersThesisPage("thesis-creator"), true);
  assert.equal(isMastersThesisPage("thesis-revision"), true);
});
