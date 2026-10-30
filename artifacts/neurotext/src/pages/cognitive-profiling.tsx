import { useEffect, useRef, useState } from "react";
import WritingNavigation from "@/components/writing-navigation";
import LiveGenerationPopup from "@/components/live-generation-popup";

const DRAFT_KEY = "neurotext-cognitive-profiling-draft";
const PAGE_TITLE = "Cognitive profiling";

type Draft = { text: string; instructions: string; output: string; critique: string; previousOutput: string };

function loadDraft(): Draft {
  const empty: Draft = { text: "", instructions: "", output: "", critique: "", previousOutput: "" };
  try {
    const saved = typeof window !== "undefined" ? sessionStorage.getItem(DRAFT_KEY) : null;
    if (!saved) return empty;
    const d = JSON.parse(saved);
    if (!d || typeof d !== "object") return empty;
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    return { text: s(d.text), instructions: s(d.instructions), output: s(d.output), critique: s(d.critique), previousOutput: s(d.previousOutput) };
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
const primary = "rounded-md bg-blue-700 px-5 py-3 text-base font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"" | "copied" | "failed">("");
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={!text.trim()}
        aria-label={`Copy ${label.toLowerCase()}`}
        data-testid={`button-copy-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
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

function Box({ id, label, text, onChange, disabled, upload, minH = "min-h-32" }: { id: string; label: string; text: string; onChange: (t: string) => void; disabled: boolean; upload: boolean; minH?: string }) {
  const [error, setError] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="block text-base font-semibold">{label}</label>
        <CopyButton text={text} label={label} />
      </div>
      <div className="rounded-md border border-slate-300 bg-white">
        <textarea
          id={id}
          data-testid={`input-${id}`}
          value={text}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={`block ${minH} w-full resize-y rounded-md p-3 text-base outline-none focus:ring-2 focus:ring-blue-600`}
        />
        {upload && (
          <input
            type="file"
            accept=".txt,.md,text/*"
            disabled={disabled}
            data-testid={`upload-${id}`}
            aria-label={`Upload ${label.toLowerCase()}`}
            className="block w-full border-t border-slate-200 p-3 text-sm file:mr-3 file:rounded file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5"
            onChange={async (event) => {
              const selected = event.target.files?.[0] ?? null;
              setError("");
              if (selected && (selected.type.startsWith("text/") || /\.(txt|md)$/i.test(selected.name))) {
                try {
                  onChange(await selected.text());
                } catch {
                  setError("This file could not be read. Paste the text instead.");
                }
              } else if (selected) {
                setError("Use a text or Markdown file, or paste the text above.");
              }
              event.target.value = "";
            }}
          />
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

const DEFAULT_TASK =
  "Produce an evidence-led cognitive profile of the writing supplied as the source text. Analyze reasoning style, conceptual habits, use of evidence, level of abstraction, underlying assumptions, strengths, and limits. Cite brief actual excerpts from the source text to support each observation. Distinguish clearly between what is observed in the text and tentative interpretation of it. State uncertainty, and say when the evidence is insufficient, in proportion to how much the text actually shows. Do not assert or speculate about mental illness, diagnoses, IQ, or sensitive personal traits. Do not conflate a narrator, character, or quoted voice with the author.";

const DISCIPLINE =
  "The user's instructions may set focus, length, format, or emphasis, but they do not override the evidence discipline above: cite actual excerpts, separate observation from interpretation, note uncertainty, and make no diagnoses or sensitive trait inferences.";

function initialTask(userInstructions: string) {
  const u = userInstructions.trim();
  return [
    DEFAULT_TASK,
    u ? `USER INSTRUCTIONS:\n${u}\n\n${DISCIPLINE}` : "",
    "Return only the profile.",
  ].filter(Boolean).join("\n\n");
}

function revisionTask(userInstructions: string, currentProfile: string, critique: string) {
  const u = userInstructions.trim();
  const c = critique.trim();
  return [
    DEFAULT_TASK,
    u ? `ORIGINAL USER INSTRUCTIONS:\n${u}\n\n${DISCIPLINE}` : "",
    "TASK: Revise the PREVIOUS ANALYSIS below into an improved cognitive profile. The source text supplied separately is the ONLY evidence about the author. The previous analysis is not evidence about the author; it is a draft to be revised. Re-check its claims against the source text, correct or remove anything the source text does not support, and retain sound analysis that is not implicated by the revision instructions.",
    `=== BEGIN PREVIOUS ANALYSIS (draft to revise, not source evidence) ===\n${currentProfile}\n=== END PREVIOUS ANALYSIS ===`,
    c
      ? `=== BEGIN REVISION INSTRUCTIONS (user's critique; apply these changes; the critique is not evidence about the author) ===\n${c}\n=== END REVISION INSTRUCTIONS ===`
      : "REVISION INSTRUCTIONS: None given. Reassess the previous analysis against the source text and improve its evidence grounding: strengthen excerpt citations, separate observation from interpretation more clearly, and calibrate uncertainty.",
    "Return only the complete revised profile. Do not discuss the revision process.",
  ].filter(Boolean).join("\n\n");
}

export default function CognitiveProfiling() {
  const [initial] = useState(loadDraft);
  const [text, setText] = useState(initial.text);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [output, setOutput] = useState(initial.output);
  const [critique, setCritique] = useState(initial.critique);
  const [previousOutput, setPreviousOutput] = useState(initial.previousOutput);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [popupOpen, setPopupOpen] = useState(false);
  const [liveText, setLiveText] = useState("");
  const running = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    document.title = `${PAGE_TITLE} | NEUROTEXT`;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ text, instructions, output, critique, previousOutput }));
    } catch {
      // Storage may be full or unavailable; the page keeps working.
    }
  }, [text, instructions, output, critique, previousOutput]);

  const downloadOutput = () => {
    if (!output.trim()) return;
    const url = URL.createObjectURL(new Blob([output], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "neurotext-cognitive-profile.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const run = async (revise: boolean) => {
    if (running.current) return;
    // Snapshot everything at submission.
    const sourceSnap = text;
    const instructionsSnap = instructions;
    const outputSnap = output;
    const critiqueSnap = critique;
    if (!sourceSnap.trim()) return;
    if (revise && !outputSnap.trim()) return;

    const baseInstructions = revise ? revisionTask(instructionsSnap, outputSnap, critiqueSnap) : initialTask(instructionsSnap);
    const targetWords = revise
      ? parseTargetWords(critiqueSnap) ?? parseTargetWords(instructionsSnap)
      : parseTargetWords(instructionsSnap);

    if (revise) setPreviousOutput(outputSnap);
    running.current = true;
    setBusy(true);
    setError("");
    setLiveText("");
    setStatus(revise ? "Revising profile…" : "Profiling…");
    setPopupOpen(true);

    const safe = (fn: () => void) => {
      if (mounted.current) fn();
    };
    let doc = "";
    let skeleton = "";
    let recovery = 0;
    const show = (t: string) =>
      safe(() => {
        setLiveText(t);
        if (t) setOutput(t);
      });

    try {
      while (mounted.current) {
        const continuation =
          doc && !targetWords
            ? `\n\nCONTINUATION: The profile was interrupted. The partial profile already written is below. Continue it from the exact point where it ends. Do not repeat or restart any of it; output only the continuation text.\n=== BEGIN PARTIAL PROFILE ===\n${doc}\n=== END PARTIAL PROFILE ===`
            : "";
        const prefix = continuation ? doc : "";
        let attemptText = "";
        try {
          const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/functions/stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              functionId: "profile",
              text: sourceSnap,
              instructions: baseInstructions + continuation,
              provider: "ZHI 1",
              targetWords,
              resumeDocument: targetWords && doc ? doc : undefined,
              resumeSkeleton: targetWords && skeleton ? skeleton : undefined,
            }),
          });
          if (!response.ok) {
            if (response.status >= 400 && response.status < 500) {
              const denial = await response.json().catch(() => ({}));
              const message = String(denial.message || denial.error || "The request was refused.");
              safe(() => {
                setError(message);
                setStatus(doc ? "Stopped. Partial output preserved." : "Stopped");
              });
              return;
            }
            throw new Error("The connection was interrupted.");
          }
          if (!response.body) throw new Error("No response stream was received.");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let completed = false;
          const sep = prefix && !/\s$/.test(prefix) ? " " : "";
          const setDoc = () => {
            doc = prefix ? prefix + (attemptText ? sep + attemptText.replace(/^\s+/, "") : "") : attemptText;
            show(doc);
          };
          const consume = (line: string) => {
            if (!line.trim()) return;
            let event: { type?: string; text?: unknown; skeleton?: unknown; message?: unknown; error?: unknown };
            try {
              event = JSON.parse(line);
            } catch {
              return;
            }
            switch (event.type) {
              case "token":
                if (prefix) {
                  attemptText += String(event.text ?? "");
                  setDoc();
                } else {
                  doc += String(event.text ?? "");
                  show(doc);
                }
                safe(() => setStatus("Writing…"));
                break;
              case "replace_output":
                if (prefix) {
                  attemptText = String(event.text ?? "");
                  setDoc();
                } else {
                  doc = String(event.text ?? "");
                  show(doc);
                }
                break;
              case "skeleton_token":
                skeleton += String(event.text ?? "");
                break;
              case "plan_ready":
                if (typeof event.skeleton === "string") skeleton = event.skeleton;
                break;
              case "section_start":
                if (doc && !doc.endsWith("\n\n")) {
                  if (prefix) attemptText += "\n\n";
                  else doc += "\n\n";
                  if (prefix) setDoc();
                  else show(doc);
                }
                break;
              case "provider_retry":
                safe(() => setStatus("Reconnecting. Your text is preserved…"));
                break;
              case "done":
                completed = true;
                break;
              case "error":
              case "quality_failed":
                throw new Error(String(event.message || event.error || "Continuing the profile."));
            }
          };
          try {
            while (true) {
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
          if (!completed || !doc.trim()) throw new Error("Continuing the profile.");
          safe(() => setStatus("Complete"));
          return;
        } catch {
          recovery += 1;
          const delay = Math.min(30000, 1000 * 2 ** Math.min(recovery - 1, 5));
          safe(() => setStatus(`Reconnecting in ${Math.round(delay / 1000)}s. Your text${doc ? " and partial output are" : " is"} preserved…`));
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    } finally {
      running.current = false;
      safe(() => setBusy(false));
    }
  };

  return (
    <main className="min-h-screen bg-white px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-6">
        <WritingNavigation current="profile" busy={busy} />
        <h1 className="text-2xl font-semibold">{PAGE_TITLE}</h1>
        <Box id="profile-text" label="Text to profile" text={text} onChange={setText} disabled={busy} upload minH="min-h-48" />
        <Box id="profile-instructions" label="Instructions (optional)" text={instructions} onChange={setInstructions} disabled={busy} upload={false} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" data-testid="button-profile" onClick={() => void run(false)} disabled={busy || !text.trim()} className={primary}>
            {busy ? "Working…" : "Profile"}
          </button>
          {busy && !popupOpen && (
            <button type="button" data-testid="button-show-live" onClick={() => setPopupOpen(true)} className={btn}>Show live output</button>
          )}
        </div>
        {status && <p role="status" data-testid="status-profile" className="text-sm text-slate-600">{status}</p>}
        {error && <p role="alert" data-testid="error-profile" className="text-sm text-red-700">{error}</p>}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="profile-output" className="block text-base font-semibold">Output</label>
            <div className="flex flex-wrap items-center gap-3">
              <CopyButton text={output} label="Output" />
              <button type="button" data-testid="button-download-output" onClick={downloadOutput} disabled={!output.trim()} className={`${btn} px-3 py-1 text-sm`}>Download .txt</button>
            </div>
          </div>
          <textarea
            id="profile-output"
            data-testid="text-output"
            value={output}
            readOnly
            className="block min-h-64 w-full resize-y rounded-md border border-slate-300 bg-white p-3 font-mono text-base outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <Box id="profile-critique" label="Critique and regenerate" text={critique} onChange={setCritique} disabled={busy} upload={false} minH="min-h-24" />
        <button type="button" data-testid="button-critique-regenerate" onClick={() => void run(true)} disabled={busy || !text.trim() || !output.trim()} className={primary}>
          {busy ? "Working…" : "Critique and regenerate"}
        </button>
      </div>
      <LiveGenerationPopup open={popupOpen} onClose={() => setPopupOpen(false)} text={liveText} busy={busy} status={error ? `Error: ${error}` : status} title={PAGE_TITLE} />
    </main>
  );
}
