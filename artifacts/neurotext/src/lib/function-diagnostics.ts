import { DIAGNOSTIC_CASES, diagnosticChecks, type DiagnosticCase } from "./diagnostic-cases.ts";

export { DIAGNOSTIC_CASES };
export const FIRST_TEXT_LIMIT_MS = 20_000;
export const TOTAL_TIME_LIMIT_MS = 90_000;
export type DiagnosticResult = {
  id: string; name: string; path: string; preview: boolean; phase: "generation" | "revision";
  status: "queued" | "running" | "passed" | "warning" | "failed" | "cancelled" | "skipped";
  input: string; output: string; provider: string; error?: string;
  startedAt?: string; firstTextMs?: number; totalMs?: number; words: number;
  tokenEvents: number; textReads: number; streamSpanMs: number;
  streaming?: "incremental" | "buffered" | "insufficient";
  checks: string[]; speedPassed?: boolean;
};

export function initialDiagnosticResults(provider: string): DiagnosticResult[] {
  return DIAGNOSTIC_CASES.flatMap(test => [false, true].map(revision => ({
    id: test.id + (revision ? "-revision" : ""), name: test.name + (revision ? " — rewrite output" : ""),
    path: test.path, preview: Boolean(test.preview), phase: revision ? "revision" : "generation",
    status: "queued", input: "", output: "", provider, words: 0, tokenEvents: 0, textReads: 0, streamSpanMs: 0, checks: [],
  })));
}

export async function runFunctionDiagnostics(options: {
  provider: string; signal: AbortSignal; onUpdate: (result: DiagnosticResult) => void;
  basePath?: string; fetcher?: typeof fetch;
  caseIds?: string[];
}): Promise<void> {
  const initial = initialDiagnosticResults(options.provider);
  const cases = options.caseIds ? DIAGNOSTIC_CASES.filter(test => options.caseIds!.includes(test.id)) : DIAGNOSTIC_CASES;
  const fetcher = options.fetcher ?? fetch;
  const run = async (test: DiagnosticCase, revision = false, previous = "") => {
    const result = { ...initial.find(row => row.id === test.id + (revision ? "-revision" : ""))! };
    const start = performance.now();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal.addEventListener("abort", cancel, { once: true });
    if (options.signal.aborted) cancel();
    // A failed model is a failed test, not a silent fallback or endless retry.
    const deadline = setTimeout(cancel, 120_000);
    const body = revision
      ? { functionId: test.id === "translator" ? "translation-revision" : "manipulator", text: previous,
          instructions: test.id === "translator"
            ? "TARGET LANGUAGE: English\nRevise this existing translation. Preserve all its facts and sentences. Improve wording only. Return only the revised translation."
            : JSON.stringify({ authorPrompt: 1, function: "manipulator", revision: true, instructions: "Improve the wording while preserving every fact, speaker, claim, distinction and section. Return the entire revised output. Do not expand it." }) }
      : { ...test.body };
    const endpoint = revision ? "/functions/stream" : test.endpoint;
    const payload = { ...body, provider: options.provider };
    result.status = "running"; result.startedAt = new Date().toISOString(); result.input = JSON.stringify(payload, null, 2);
    options.onUpdate({ ...result });
    let completed = false;
    let previewAcknowledged = false;
    let lastTextAt = 0;
    let firstTextAt = 0;
    const consume = (line: string) => {
      if (!line.trim()) return false;
      const event = JSON.parse(line);
      if (event.type === "error") throw new Error(String(event.message || event.error || "Generation failed."));
      if (event.type === "done") {
        completed = true;
        previewAcknowledged = event.diagnosticPreview === true;
      }
      if (event.type === "replace_output") result.output = String(event.text ?? "");
      if (event.type !== "token" || !event.text) return false;
      const now = performance.now();
      if (!firstTextAt) { firstTextAt = now; result.firstTextMs = now - start; }
      lastTextAt = now; result.tokenEvents++; result.output += String(event.text);
      return true;
    };
    try {
      const response = await fetcher(`${options.basePath ?? ""}/api${endpoint}`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || error.message || `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("The response had no readable stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let index; let hadText = false;
          while ((index = buffer.indexOf("\n")) >= 0) {
            hadText = consume(buffer.slice(0, index)) || hadText;
            buffer = buffer.slice(index + 1);
          }
          if (hadText) result.textReads++;
          result.streamSpanMs = lastTextAt - firstTextAt;
          result.words = result.output.trim() ? result.output.trim().split(/\s+/).length : 0;
          options.onUpdate({ ...result });
        }
        buffer += decoder.decode();
        if (buffer.trim() && consume(buffer)) result.textReads++;
      } finally { await reader.cancel().catch(() => {}); }
      if (!completed) throw new Error("The stream closed without a completion event. Partial output is preserved.");
      result.checks = revision
        ? (result.output.trim() ? [] : ["Revision returned no output."])
        : diagnosticChecks(test, result.output);
      if (test.preview && !revision && !previewAcknowledged) result.checks.push("The server did not acknowledge the bounded academic sample.");
      if (revision && test.expect === "replacement" && !/blue balloon/i.test(result.output)) result.checks.push("Revision lost the requested blue-balloon change.");
      if (revision && test.expect === "translation" && !/library/i.test(result.output)) result.checks.push("Revision lost the library sentence.");
      result.streaming = result.textReads >= 2 ? "incremental"
        : result.tokenEvents > 1 ? "buffered" : "insufficient";
      result.totalMs = performance.now() - start;
      result.speedPassed = (result.firstTextMs ?? Infinity) <= FIRST_TEXT_LIMIT_MS && result.totalMs <= TOTAL_TIME_LIMIT_MS;
      result.status = result.checks.length ? "failed" : !result.speedPassed || result.streaming !== "incremental" ? "warning" : "passed";
    } catch (error) {
      result.status = options.signal.aborted ? "cancelled" : "failed";
      result.error = controller.signal.aborted && !options.signal.aborted
        ? "Test exceeded the 120-second timeout. Partial output preserved."
        : error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(deadline); options.signal.removeEventListener("abort", cancel);
      result.totalMs = performance.now() - start;
      result.words = result.output.trim() ? result.output.trim().split(/\s+/).length : 0;
      options.onUpdate({ ...result });
    }
    return result;
  };
  let next = 0;
  const worker = async () => {
    while (next < cases.length && !options.signal.aborted) {
      const test = cases[next++];
      const original = await run(test);
      if (options.signal.aborted) break;
      if (original.status === "failed") {
        options.onUpdate({ ...initial.find(row => row.id === `${test.id}-revision`)!, status: "skipped", error: "Initial generation failed; there is no reliable output to revise." });
      } else await run(test, true, original.output);
    }
  };
  await Promise.all([worker(), worker()]);
}
