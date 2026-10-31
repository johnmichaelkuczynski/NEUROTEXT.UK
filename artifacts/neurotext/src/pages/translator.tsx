import { selectedModel } from "@/components/model-selector";
import OutputWordCount from "@/components/output-word-count";
import { useEffect, useRef, useState } from "react";
import WritingNavigation from "@/components/writing-navigation";
import LiveGenerationPopup from "@/components/live-generation-popup";
import type { TranslationTerm } from "@workspace/api-client-react";

const DRAFT_KEY = "neurotext-translator-draft";
const PAGE_TITLE = "Translator";

type Draft = { sourceText: string; targetLanguage: string; instructions: string; output: string; critique: string; terminology: TranslationTerm[] };

function readTerminology(value: unknown): TranslationTerm[] {
  if (!Array.isArray(value) || value.length > 1000) return [];
  return value.filter((term): term is TranslationTerm =>
    !!term && typeof term.source === "string" && !!term.source.trim() && term.source.length <= 200
    && typeof term.target === "string" && !!term.target.trim() && term.target.length <= 200);
}

function loadDraft(): Draft {
  const empty: Draft = { sourceText: "", targetLanguage: "English", instructions: "", output: "", critique: "", terminology: [] };
  try {
    const saved = typeof window !== "undefined" ? sessionStorage.getItem(DRAFT_KEY) : null;
    if (!saved) return empty;
    const d = JSON.parse(saved);
    if (!d || typeof d !== "object") return empty;
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    return {
      sourceText: s(d.sourceText),
      targetLanguage: typeof d.targetLanguage === "string" ? d.targetLanguage : "English",
      instructions: s(d.instructions),
      output: s(d.output),
      critique: s(d.critique),
      terminology: readTerminology(d.terminology),
    };
  } catch {
    return empty;
  }
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

const DEFAULT_TRANSLATION =
  "Detect the language of the source text automatically. Produce a faithful, natural translation that preserves the meaning, tone, register, paragraph structure, names, numbers, figures, and citations of the source. Do not invent claims, and do not add headings, commentary, notes, references, or explanations that are not in the source. Do not impose an academic or scholarly style unless the source or the user asks for it.";

const PREFS_RULE =
  "The user's preferences take priority over the defaults above: if they ask for a literal translation, stay close to the source wording; if they ask for a literary or free-flowing translation, prioritize natural idiom and style in the target language; if they ask for shortening, condensing, or summarizing, do so as requested. Never invent content.";

function initialTask(targetLanguage: string, prefs: string) {
  const p = prefs.trim();
  return [
    `TARGET LANGUAGE: ${targetLanguage.trim()}`,
    `TASK: Translate the source text into ${targetLanguage.trim()}.`,
    DEFAULT_TRANSLATION,
    p ? `=== BEGIN USER TRANSLATION PREFERENCES ===\n${p}\n=== END USER TRANSLATION PREFERENCES ===\n\n${PREFS_RULE}` : "",
    `Return only the translation in ${targetLanguage.trim()}.`,
  ].filter(Boolean).join("\n\n");
}

function revisionTask(targetLanguage: string, prefs: string, critique: string, originalSource: string) {
  const p = prefs.trim();
  const c = critique.trim();
  const lang = targetLanguage.trim();
  return [
    `TARGET LANGUAGE: ${lang}`,
    `TASK: The text supplied is an existing translation into ${lang}. Revise it according to the revision instructions. Make targeted changes and preserve every part of the translation that the instructions do not affect. Do not produce a new, unrelated document. If the revision instructions request a different target language or shortening, honor that.`,
    DEFAULT_TRANSLATION,
    p ? `=== BEGIN ORIGINAL USER TRANSLATION PREFERENCES ===\n${p}\n=== END ORIGINAL USER TRANSLATION PREFERENCES ===\n\n${PREFS_RULE}` : "",
    "Original preferences still guide style and terminology. Preserve the CURRENT translation's length unless the user's new critique explicitly requests a length change. Do not apply an original shortening instruction a second time.",
    c
      ? `=== BEGIN REVISION INSTRUCTIONS (user's critique; apply these changes) ===\n${c}\n=== END REVISION INSTRUCTIONS ===`
      : "REVISION INSTRUCTIONS: None given. Make conservative improvements only: correct errors, awkward phrasing, and unnatural idiom while keeping the translation's content, structure, and length.",
    originalSource.trim()
      ? `=== BEGIN ORIGINAL SOURCE (reference only, for checking accuracy of the translation; do not translate it afresh as a new draft) ===\n${originalSource}\n=== END ORIGINAL SOURCE ===`
      : "",
    "Return only the complete revised translation. Do not discuss the revision process.",
  ].filter(Boolean).join("\n\n");
}

export default function Translator() {
  const [initial] = useState(loadDraft);
  const [sourceText, setSourceText] = useState(initial.sourceText);
  const [targetLanguage, setTargetLanguage] = useState(initial.targetLanguage);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [output, setOutput] = useState(initial.output);
  const [critique, setCritique] = useState(initial.critique);
  const [terminology, setTerminology] = useState(initial.terminology);
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
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ sourceText, targetLanguage, instructions, output, critique, terminology }));
    } catch {
      // Storage may be full or unavailable; the page keeps working.
    }
  }, [sourceText, targetLanguage, instructions, output, critique, terminology]);

  const downloadOutput = () => {
    if (!output.trim()) return;
    const url = URL.createObjectURL(new Blob([output], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "neurotext-translation.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const run = async (revise: boolean) => {
    const provider = selectedModel();
    if (running.current) return;
    const sourceSnap = sourceText;
    const langSnap = targetLanguage;
    const prefsSnap = instructions;
    const outputSnap = output;
    const critiqueSnap = critique;
    if (!langSnap.trim()) return;
    if (!revise && !sourceSnap.trim()) return;
    if (revise && !outputSnap.trim()) return;

    const composed = revise ? revisionTask(langSnap, prefsSnap, critiqueSnap, sourceSnap) : initialTask(langSnap, prefsSnap);

    running.current = true;
    setBusy(true);
    setError("");
    setLiveText("");
    setStatus(revise ? "Revising translation…" : "Translating…");
    setPopupOpen(true);

    const safe = (fn: () => void) => {
      if (mounted.current) fn();
    };
    let doc = "";
    let started = false;
    const show = () =>
      safe(() => {
        setLiveText(doc);
        if (started) setOutput(doc);
      });
    const retryHint = `You can retry with the ${revise ? "Critique and regenerate" : "Translate"} button.`;

    try {
      let response: Response;
      try {
        response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/functions/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            functionId: revise ? "translation-revision" : "translator",
            text: revise ? outputSnap : sourceSnap,
            instructions: composed,
            translationTerminology: revise ? terminology : undefined,
              provider,
          }),
        });
      } catch {
        throw new Error(`The connection failed before the translation started. ${retryHint}`);
      }
      if (!response.ok) {
        const denial = await response.json().catch(() => ({}));
        throw new Error(String(denial.message || denial.error || `The request failed (${response.status}).`) + ` ${retryHint}`);
      }
      if (!response.body) throw new Error(`No response stream was received. ${retryHint}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      let serverError = "";
      let terminologyWarning = "";
      const consume = (line: string) => {
        if (!line.trim() || serverError) return;
        let event: { type?: string; text?: unknown; separator?: unknown; message?: unknown; error?: unknown; terms?: unknown };
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        switch (event.type) {
          case "token": {
            const t = String(event.text ?? "");
            if (!t) break;
            if (!started && !revise) safe(() => setTerminology([]));
            started = true;
            doc += t;
            show();
            safe(() => setStatus("Writing…"));
            break;
          }
          case "replace_output":
            doc = String(event.text ?? "");
            if (doc) started = true;
            show();
            break;
          case "section_start":
            if (doc) {
              const sep = typeof event.separator === "string" ? event.separator : "\n\n";
              if (sep) {
                doc += sep;
                show();
              }
            }
            break;
          case "provider_retry":
            safe(() => setStatus(typeof event.message === "string" && event.message.trim() ? event.message : "Provider busy. Retrying…"));
            break;
          case "translation_terminology":
            safe(() => setTerminology(readTerminology(event.terms)));
            break;
          case "translation_terminology_warning":
            terminologyWarning = String(event.message || "Terminology tracking could not update. Review terminology in the completed text.");
            break;
          case "done":
            completed = true;
            break;
          case "error":
          case "quality_failed":
            serverError = String(event.message || event.error || "The translation failed.");
            break;
        }
      };
      try {
        while (true) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch {
            throw new Error(
              started
                ? `The connection was interrupted. The partial translation is preserved but incomplete. ${retryHint}`
                : `The connection was interrupted. ${retryHint}`,
            );
          }
          const { value, done } = chunk;
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) consume(line);
          if (serverError) break;
          if (done) {
            consume(buffer);
            break;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (serverError) throw new Error(`${serverError} ${retryHint}`);
      if (!completed || !doc.trim()) {
        throw new Error(
          started
            ? `The translation stopped before finishing. The partial output is preserved but incomplete. ${retryHint}`
            : `No translation was received. ${retryHint}`,
        );
      }
      safe(() => setStatus(terminologyWarning ? `Complete. ${terminologyWarning}` : "Complete"));
    } catch (err) {
      const message = err instanceof Error ? err.message : `The translation failed. ${retryHint}`;
      safe(() => {
        setError(message);
        setStatus(started ? "Stopped. Partial output preserved." : "Stopped");
      });
    } finally {
      running.current = false;
      safe(() => setBusy(false));
    }
  };

  const langOk = !!targetLanguage.trim();

  return (
    <main className="min-h-screen bg-white px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-6">
        <WritingNavigation current="translator" busy={busy} />
        <h1 className="text-2xl font-semibold">{PAGE_TITLE}</h1>
        <Box id="translator-source" label="Text to translate" text={sourceText} onChange={setSourceText} disabled={busy} upload minH="min-h-48" />
        <div className="space-y-2">
          <label htmlFor="translator-target-language" className="block text-base font-semibold">Translate into</label>
          <input
            id="translator-target-language"
            data-testid="input-target-language"
            type="text"
            value={targetLanguage}
            disabled={busy}
            onChange={(event) => setTargetLanguage(event.target.value)}
            className="block w-full max-w-xs rounded-md border border-slate-300 bg-white p-2 text-base outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <Box id="translator-instructions" label="Instructions (optional)" text={instructions} onChange={setInstructions} disabled={busy} upload={false} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" data-testid="button-translate" onClick={() => void run(false)} disabled={busy || !sourceText.trim() || !langOk} className={primary}>
            {busy ? "Working…" : "Translate"}
          </button>
          {busy && !popupOpen && (
            <button type="button" data-testid="button-show-live" onClick={() => setPopupOpen(true)} className={btn}>Show live output</button>
          )}
        </div>
        {status && <p role="status" data-testid="status-translator" className="text-sm text-slate-600">{status}</p>}
        {error && <p role="alert" data-testid="error-translator" className="text-sm text-red-700">{error}</p>}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="translator-output" className="block text-base font-semibold">Output <OutputWordCount text={output} /></label>
            <div className="flex flex-wrap items-center gap-3">
              <CopyButton text={output} label="Output" />
              <button type="button" data-testid="button-download-output" onClick={downloadOutput} disabled={!output.trim()} className={`${btn} px-3 py-1 text-sm`}>Download .txt</button>
            </div>
          </div>
          <textarea
            id="translator-output"
            data-testid="text-output"
            value={output}
            readOnly
            className="block min-h-64 w-full resize-y rounded-md border border-slate-300 bg-white p-3 font-mono text-base outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <Box id="translator-critique" label="Critique and regenerate" text={critique} onChange={setCritique} disabled={busy} upload={false} minH="min-h-24" />
        <button type="button" data-testid="button-critique-regenerate" onClick={() => void run(true)} disabled={busy || !output.trim() || !langOk} className={primary}>
          {busy ? "Working…" : "Critique and regenerate"}
        </button>
      </div>
      <LiveGenerationPopup open={popupOpen} onClose={() => setPopupOpen(false)} text={liveText} busy={busy} status={error ? `Error: ${error}` : status} title={PAGE_TITLE} />
    </main>
  );
}
