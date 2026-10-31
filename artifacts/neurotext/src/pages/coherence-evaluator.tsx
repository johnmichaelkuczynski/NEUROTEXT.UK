import { selectedModel } from "@/components/model-selector";
import { useEffect, useRef, useState } from "react";
import WritingNavigation from "@/components/writing-navigation";
import LiveGenerationPopup from "@/components/live-generation-popup";
import RewriteOutput from "@/components/rewrite-output";
import { clearWritingPage } from "@/lib/clear-writing-page";

const DRAFT_KEY = "neurotext-coherence-evaluator-draft";
const PAGE_TITLE = "Coherence evaluator";

type Draft = { text: string; instructions: string; output: string; evaluationVersion?: string };

function loadDraft(): Draft {
  const empty: Draft = { text: "", instructions: "", output: "" };
  try {
    const saved = typeof window !== "undefined" ? sessionStorage.getItem(DRAFT_KEY) : null;
    if (!saved) return empty;
    const d = JSON.parse(saved);
    return {
      text: typeof d?.text === "string" ? d.text : "",
      instructions: typeof d?.instructions === "string" ? d.instructions : "",
      output: typeof d?.output === "string" ? d.output : "",
      evaluationVersion: typeof d?.evaluationVersion === "string" ? d.evaluationVersion : undefined,
    };
  } catch {
    return empty;
  }
}

function parseTargetWords(text: string): string | undefined {
  const m = text.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*(?:-|\s)?\s*words?\b/i);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? String(n) : undefined;
}

function pickMode(instructions: string): "autodetect" | "mathematical" | "logical" {
  const t = instructions.toLowerCase();
  const math = /\bmathematical coherence\b|\bmathematical(ly)?\b.*\bcoheren/.test(t);
  const logic = /\bnon[- ]?(?:self[- ]?)?contradiction\b|\blogical consistency\b|\blogical coherence\b/.test(t);
  if (math && !logic) return "mathematical";
  if (logic && !math) return "logical";
  return "autodetect";
}

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the selection fallback.
  }
  const selection = document.createElement("textarea");
  selection.value = text;
  selection.style.position = "fixed";
  selection.style.opacity = "0";
  document.body.appendChild(selection);
  selection.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Clipboard unavailable.");
  } finally {
    selection.remove();
  }
}

const btn = "rounded-md border border-slate-300 bg-white px-4 py-2 font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"" | "copied" | "failed">("");
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={!text.trim()}
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={async () => {
          try {
            await copyText(text);
            setState("copied");
          } catch {
            setState("failed");
          }
          window.setTimeout(() => setState(""), 2500);
        }}
        className={`${btn} px-3 py-1 text-sm`}
      >
        {state === "copied" ? "Copied" : "Copy"}
      </button>
      {state === "failed" && <span role="alert" className="text-sm text-red-700">Copy was blocked. Select the text manually.</span>}
    </span>
  );
}

function Box({ id, label, text, onChange, disabled, minH }: { id: string; label: string; text: string; onChange: (t: string) => void; disabled: boolean; minH: string }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="block text-base font-semibold">{label}</label>
        <CopyButton text={text} label={label} />
      </div>
      <textarea
        id={id}
        value={text}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`block ${minH} w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-base outline-none focus:ring-2 focus:ring-blue-600`}
      />
    </div>
  );
}

export default function CoherenceEvaluator() {
  const [initial] = useState(loadDraft);
  const [text, setText] = useState(initial.text);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [output, setOutput] = useState(initial.output);
  const [evaluationVersion, setEvaluationVersion] = useState(initial.evaluationVersion);
  const [busy, setBusy] = useState(false);
  const [rewritingOutput, setRewritingOutput] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [popupOpen, setPopupOpen] = useState(false);
  const [liveText, setLiveText] = useState("");
  const running = useRef(false);

  useEffect(() => {
    document.title = `${PAGE_TITLE} | NEUROTEXT`;
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ text, instructions, output, evaluationVersion }));
    } catch {
      // Storage may be unavailable; the page keeps working.
    }
  }, [text, instructions, output, evaluationVersion]);

  const downloadOutput = () => {
    if (!output.trim()) return;
    const url = URL.createObjectURL(new Blob([output], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "neurotext-coherence-evaluation.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const evaluate = async () => {
    const provider = selectedModel();
    if (!text.trim() || running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setLiveText("");
    setStatus("Starting coherence evaluation…");
    setPopupOpen(true);
    let report = "";
    let prep = "";
    let completed = false;
    let receivedVersion: string | undefined;
    const fail = (message: string) => {
      setError(message);
      setStatus(report ? "Evaluation stopped. Partial report preserved." : "Evaluation stopped");
    };
    try {
      const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/coherence/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: "Coherence evaluation",
          text,
          instructions: instructions.trim() ? instructions : undefined,
          provider,
          mode: pickMode(instructions),
          allowFallback: true,
          targetWords: parseTargetWords(instructions),
        }),
      });
      if (!response.ok) {
        const denial = await response.json().catch(() => ({}));
        fail(String(denial.message || denial.error || "The request was refused."));
        return;
      }
      if (!response.body) {
        fail("No response stream was received.");
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fatal = "";
      const consume = (line: string) => {
        if (!line.trim() || fatal) return;
        let event: { type?: string; text?: unknown; skeleton?: unknown; index?: unknown; total?: unknown; message?: unknown; error?: unknown; evaluationVersion?: string };
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        switch (event.type) {
          case "analysis_started":
            receivedVersion = event.evaluationVersion;
            setStatus("Testing consistency and reasoning…");
            break;
          case "evidence_token": {
            prep += String(event.text ?? "");
            if (!report) setLiveText(prep);
            const i = Number(event.index), n = Number(event.total);
            setStatus(Number.isFinite(i) && Number.isFinite(n) && n > 0 ? `Gathering evidence (part ${i + 1} of ${n})…` : "Gathering evidence…");
            break;
          }
          case "skeleton_token":
            prep += String(event.text ?? "");
            if (!report) setLiveText(prep);
            setStatus("Mapping structure…");
            break;
          case "skeleton":
            if (!report && typeof event.text === "string") {
              prep = event.text;
              setLiveText(prep);
            }
            setStatus("Structure mapped. Writing report…");
            break;
          case "token":
            setEvaluationVersion(receivedVersion);
            report += String(event.text ?? "");
            setLiveText(report);
            setOutput(report);
            setStatus("Writing report…");
            break;
          case "replace_output":
            report = String(event.text ?? "");
            setLiveText(report);
            setOutput(report);
            break;
          case "done":
            completed = true;
            break;
          case "error":
            fatal = String(event.message || event.error || "The evaluation could not be completed.");
            break;
        }
      };
      try {
        while (!fatal) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) consume(line);
          if (done) {
            consume(buffer);
            break;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (fatal) fail(fatal);
      else if (!completed) fail("The connection ended before the evaluation finished. Try again.");
      else setStatus("Complete");
    } catch {
      fail("The connection was interrupted. Your text and any partial report are preserved.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-white px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-6">
        <WritingNavigation current="coherence" busy={busy} />
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">{PAGE_TITLE}</h1>
          <button type="button" className={btn} onClick={() => {
            try {
              clearWritingPage(DRAFT_KEY);
            } catch {
              setError("The browser blocked clearing saved text. Allow browser storage and try again.");
              return;
            }
          }}>Clear</button>
        </div>
        <Box id="coherence-text" label="Text to evaluate" text={text} onChange={setText} disabled={busy} minH="min-h-48" />
        <Box id="coherence-instructions" label="Instructions (optional)" text={instructions} onChange={setInstructions} disabled={busy} minH="min-h-32" />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void evaluate()}
            disabled={busy || !text.trim()}
            className="rounded-md bg-blue-700 px-5 py-3 text-base font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Evaluating coherence…" : "Evaluate coherence"}
          </button>
          {busy && !rewritingOutput && !popupOpen && (
            <button type="button" onClick={() => setPopupOpen(true)} className={btn}>Show live output</button>
          )}
        </div>
        {status && <p role="status" className="text-sm text-slate-600">{status}</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="space-y-2">
          {output && evaluationVersion !== "reasoning-v2" && <p role="status" className="text-sm text-amber-800">Saved report from an earlier or unversioned evaluator. Evaluate coherence to produce a new analysis; the saved report has not been replaced.</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="coherence-output" className="block text-base font-semibold">Output</label>
            <div className="flex flex-wrap items-center gap-3">
              <CopyButton text={output} label="Output" />
              <button type="button" onClick={downloadOutput} disabled={!output.trim()} className={`${btn} px-3 py-1 text-sm`}>Download .txt</button>
            </div>
          </div>
          <textarea
            id="coherence-output"
            value={output}
            readOnly
            className="block min-h-64 w-full resize-y rounded-md border border-slate-300 bg-white p-3 font-mono text-base outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <RewriteOutput output={output} onOutputChange={setOutput} busy={busy}
          onBusyChange={(value) => { setBusy(value); setRewritingOutput(value); if (value) setPopupOpen(false); }}
          onStatusChange={setStatus} onErrorChange={setError} storageKey={DRAFT_KEY} documentKind="coherence analysis report" />
      </div>
      <LiveGenerationPopup
        open={popupOpen}
        onClose={() => setPopupOpen(false)}
        text={liveText}
        busy={busy}
        status={error ? `Error: ${error}` : status}
        title={PAGE_TITLE}
      />
    </main>
  );
}
