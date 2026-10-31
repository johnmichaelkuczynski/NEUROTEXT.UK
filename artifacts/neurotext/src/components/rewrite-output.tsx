import { selectedModel } from "./model-selector";
import { useEffect, useId, useRef, useState } from "react";
import LiveGenerationPopup from "@/components/live-generation-popup";

type Props = {
  output: string;
  onOutputChange: (text: string) => void;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onStatusChange: (status: string) => void;
  onErrorChange: (error: string) => void;
  storageKey: string;
  documentKind?: string;
};

/** Revise the current result, never regenerate from the original input. */
export default function RewriteOutput({
  output, onOutputChange, busy, onBusyChange, onStatusChange, onErrorChange,
  storageKey, documentKind = "document",
}: Props) {
  const id = useId();
  const [instructions, setInstructions] = useState(() => {
    try { return sessionStorage.getItem(`${storageKey}-rewrite-instructions`) || ""; }
    catch { return ""; }
  });
  const [open, setOpen] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(`${storageKey}-rewrite-instructions`, instructions); }
    catch { /* Keep the live draft even if browser storage is unavailable. */ }
  }, [storageKey, instructions]);
  useEffect(() => {
    if (busy && !rewriting) setOpen(false);
  }, [busy, rewriting]);

  const copyInstructions = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(instructions);
      else {
        const selection = document.createElement("textarea");
        selection.value = instructions;
        selection.style.position = "fixed";
        selection.style.opacity = "0";
        document.body.appendChild(selection);
        selection.select();
        try {
          if (!document.execCommand("copy")) throw new Error("Copy blocked.");
        } finally { selection.remove(); }
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { onErrorChange("Copy was blocked. Select the rewrite instructions to copy them manually."); }
  };

  const rewrite = async () => {
    const provider = selectedModel();
    if (busy || running.current || !output.trim()) return;
    const originalOutput = output;
    const changes = instructions.trim();
    const match = changes.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*(?:-|\s)?\s*words?\b/i);
    const targetWords = match && Number(match[1].replace(/,/g, "")) > 0
      ? String(Number(match[1].replace(/,/g, ""))) : undefined;
    const request = `Revise this existing ${documentKind}, not a new document from scratch.
Apply the requested changes to the supplied CURRENT OUTPUT. Keep all wording, content, claims, qualifications, citations, structure, and formatting that do not need changing. Preserve its genre and voice unless a change is requested. Do not invent evidence, sources, or citations.
REQUESTED CHANGES:
${changes || "Improve clarity, precision, and flow with minimal changes; preserve the existing content and style."}
Return only the complete revised ${documentKind}, without commentary about the revision.`;
    try { sessionStorage.setItem(`${storageKey}-before-output-rewrite`, originalOutput); }
    catch { /* The original remains visible until revised tokens arrive. */ }
    running.current = true;
    setRewriting(true);
    onBusyChange(true);
    onErrorChange("");
    setLiveText("");
    setOpen(true);
    let document = "";
    let skeleton = "";
    let recovery = 0;
    const updateStatus = (message: string) => {
      if (!mounted.current) return;
      setStatus(message);
      onStatusChange(message);
    };
    const show = () => {
      if (!mounted.current) return;
      setLiveText(document);
      if (document) onOutputChange(document);
    };
    updateStatus("Rewriting output…");
    try {
      while (mounted.current) {
        try {
          const continuation = document && !targetWords
            ? `\nA previous connection stopped during this revision. The following is the partial revised result already shown. Continue from its exact ending, without repeating it. Return only the remaining text:\n${document}`
            : "";
          const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/functions/stream`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              functionId: "manipulator", text: originalOutput, instructions: JSON.stringify({ authorPrompt: 1, revision: true, instructions: changes }),
              provider, targetWords,
              resumeDocument: document || undefined, resumeSkeleton: skeleton || undefined,
            }),
          });
          if (!response.ok) {
            if (response.status >= 400 && response.status < 500) {
              const denial = await response.json().catch(() => ({}));
              const message = String(denial.message || denial.error || "The rewrite request was refused.");
              if (mounted.current) onErrorChange(message);
              updateStatus(`Rewrite stopped: ${message}`);
              return;
            }
            throw new Error("Connection interrupted.");
          }
          if (!response.body) throw new Error("No response stream.");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let completed = false;
          const consume = (line: string) => {
            if (!line.trim()) return;
            let event: { type?: string; text?: string; skeleton?: string };
            try { event = JSON.parse(line); } catch { return; }
            switch (event.type) {
              case "token":
                document += String(event.text ?? "");
                show();
                updateStatus("Rewriting output…");
                break;
              case "replace_output":
                document = String(event.text ?? "");
                show();
                break;
              case "skeleton_token": skeleton += String(event.text ?? ""); break;
              case "plan_ready":
                if (typeof event.skeleton === "string") skeleton = event.skeleton;
                break;
              case "section_start":
                if (document && !document.endsWith("\n\n")) { document += "\n\n"; show(); }
                break;
              case "provider_retry": updateStatus("Reconnecting. Your output is preserved…"); break;
              case "done": completed = true; break;
              case "error":
              case "quality_failed": throw new Error("Continuing the revision.");
            }
          };
          try {
            while (true) {
              const { value, done } = await reader.read();
              buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
              const lines = buffer.split(/\r?\n/);
              buffer = lines.pop() ?? "";
              for (const line of lines) consume(line);
              if (done) { consume(buffer); break; }
            }
          } finally { await reader.cancel().catch(() => {}); }
          if (!completed || !document.trim()) throw new Error("Revision interrupted.");
          updateStatus("Complete");
          return;
        } catch {
          recovery += 1;
          updateStatus("Reconnecting. Your output is preserved…");
          await new Promise((resolve) => setTimeout(resolve, Math.min(15000, recovery * 1500)));
        }
      }
    } finally {
      running.current = false;
      if (mounted.current) {
        setRewriting(false);
        onBusyChange(false);
      }
    }
  };

  return (
    <section aria-label="Rewrite output" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="block text-base font-semibold">Rewrite output</label>
        <button type="button" onClick={() => void copyInstructions()} disabled={!instructions.trim()} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-semibold disabled:opacity-50">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <textarea id={id} value={instructions} onChange={(event) => setInstructions(event.target.value)}
        disabled={busy} placeholder="Describe the changes you want."
        className="block min-h-24 w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-base outline-none focus:ring-2 focus:ring-blue-600" />
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => void rewrite()} disabled={busy || !output.trim()}
          className="rounded-md bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
          {rewriting ? "Rewriting output…" : "Rewrite output"}
        </button>
        {rewriting && !open && <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-slate-300 px-4 py-2 font-semibold">Show live output</button>}
      </div>
      <LiveGenerationPopup open={open} onClose={() => setOpen(false)} text={liveText} busy={rewriting} status={status} title="Rewrite output" />
    </section>
  );
}
