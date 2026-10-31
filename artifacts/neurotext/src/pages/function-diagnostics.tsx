import { useEffect, useMemo, useRef, useState } from "react";
import WritingNavigation from "@/components/writing-navigation";
import { selectedModel } from "@/components/model-selector";
import {
  initialDiagnosticResults,
  runFunctionDiagnostics,
  FIRST_TEXT_LIMIT_MS,
  TOTAL_TIME_LIMIT_MS,
  type DiagnosticResult,
} from "@/lib/function-diagnostics";

const STORAGE_KEY = "neurotext-function-diagnostics-report-v1";

type StoredRun = {
  model: string;
  startedAt?: string;
  finishedAt?: string;
  stopped?: boolean;
  results: DiagnosticResult[];
};

function loadStored(): StoredRun | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRun;
    if (!parsed || !Array.isArray(parsed.results)) return null;
    return {
      ...parsed,
      results: parsed.results.map((row) =>
        row.status === "running"
          ? { ...row, status: "cancelled", error: row.error ?? "Interrupted: the page was closed or reloaded while this test was running. Partial output preserved." }
          : row,
      ),
    };
  } catch {
    return null;
  }
}

function saveStored(run: StoredRun) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(run)); } catch { /* Storage may be full or unavailable. */ }
}

const seconds = (ms?: number) => (ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} s`);

const STATUS_STYLE: Record<DiagnosticResult["status"], string> = {
  queued: "border-slate-300 bg-slate-50 text-slate-700",
  running: "border-blue-300 bg-blue-50 text-blue-800",
  passed: "border-emerald-300 bg-emerald-50 text-emerald-800",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  failed: "border-red-300 bg-red-50 text-red-800",
  cancelled: "border-slate-400 bg-slate-100 text-slate-700",
  skipped: "border-slate-300 bg-white text-slate-600",
};

const STATUS_LABEL: Record<DiagnosticResult["status"], string> = {
  queued: "Queued", running: "Running", passed: "Pass", warning: "Warning", failed: "Fail", cancelled: "Stopped / interrupted", skipped: "Skipped",
};

const btn = "rounded-md border px-4 py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60";

function Row({ row, open, onToggle }: { row: DiagnosticResult; open: boolean; onToggle: () => void }) {
  const firstOk = row.firstTextMs !== undefined && row.firstTextMs <= FIRST_TEXT_LIMIT_MS;
  const totalDone = row.status !== "running" && row.status !== "queued";
  const totalOk = row.totalMs !== undefined && row.totalMs <= TOTAL_TIME_LIMIT_MS;
  const outRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (open && row.status === "running" && outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [row.output, row.status, open]);
  return (
    <li data-testid={`row-diagnostic-${row.id}`} className="rounded-md border border-slate-300 bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid={`button-toggle-${row.id}`}
        className="flex w-full flex-wrap items-center gap-3 p-3 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
      >
        <span data-testid={`status-${row.id}`} className={`inline-flex min-w-24 justify-center rounded border px-2 py-0.5 text-sm font-semibold ${STATUS_STYLE[row.status]}`}>
          {row.status === "running" && <span className="mr-1.5 mt-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-blue-600" aria-hidden />}
          {STATUS_LABEL[row.status]}
        </span>
        <span className="flex-1 font-semibold">
          {row.name}
          <span className="ml-2 font-mono text-xs font-normal text-slate-500">{row.path}{row.phase === "revision" ? " · rewrite" : ""}</span>
          {row.preview && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-700">bounded sample</span>}
        </span>
        <span className="font-mono text-xs text-slate-600">
          first {seconds(row.firstTextMs)} · total {seconds(row.totalMs)} · {row.words} words
        </span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-200 p-3 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Metric label="First text" value={seconds(row.firstTextMs)} tone={row.firstTextMs === undefined ? "" : firstOk ? "ok" : "warn"} note={`limit ${FIRST_TEXT_LIMIT_MS / 1000} s`} />
            <Metric label="Total time" value={seconds(row.totalMs)} tone={!totalDone || row.totalMs === undefined ? "" : totalOk ? "ok" : "warn"} note={`limit ${TOTAL_TIME_LIMIT_MS / 1000} s`} />
            <Metric label="Streaming" value={row.streaming ?? (row.status === "running" ? "measuring" : "—")} tone={row.streaming ? (row.streaming === "incremental" ? "ok" : "warn") : ""} note="incremental = 2+ reads over 100 ms" />
            <Metric label="Speed" value={row.speedPassed === undefined ? "—" : row.speedPassed ? "within limits" : "too slow"} tone={row.speedPassed === undefined ? "" : row.speedPassed ? "ok" : "warn"} />
            <Metric label="Token events" value={String(row.tokenEvents)} />
            <Metric label="Network text reads" value={String(row.textReads)} />
            <Metric label="Stream span" value={seconds(row.streamSpanMs)} />
            <Metric label="Model" value={row.provider} note={row.startedAt ? new Date(row.startedAt).toLocaleTimeString() : undefined} />
          </dl>
          {row.error && <p role="alert" data-testid={`text-error-${row.id}`} className="rounded border border-red-200 bg-red-50 p-2 text-red-800">{row.error}</p>}
          {row.checks.length > 0 && (
            <div data-testid={`text-checks-${row.id}`}>
              <p className="font-semibold text-red-800">Failed functional checks</p>
              <ul className="ml-5 list-disc text-red-800">{row.checks.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          )}
          {totalDone && row.status !== "skipped" && !row.checks.length && !row.error && (
            <p className="text-slate-600">All basic format/content checks for this case passed. This is not a judgment of literary or scholarly quality.</p>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <p className="mb-1 font-semibold">Exact request input</p>
              <pre data-testid={`text-input-${row.id}`} className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-2 font-mono text-xs">{row.input || "Not sent yet."}</pre>
            </div>
            <div>
              <p className="mb-1 font-semibold">Output{row.status === "running" ? " (streaming live)" : ""}</p>
              <pre ref={outRef} data-testid={`text-output-${row.id}`} className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-white p-2 text-sm">{row.output || (row.status === "running" ? "Waiting for first text…" : "No output.")}</pre>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function Metric({ label, value, note, tone = "" }: { label: string; value: string; note?: string; tone?: "" | "ok" | "warn" }) {
  const color = tone === "ok" ? "text-emerald-800" : tone === "warn" ? "text-amber-800" : "text-slate-900";
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`font-mono ${color}`}>{value}</dd>
      {note && <dd className="text-xs text-slate-500">{note}</dd>}
    </div>
  );
}

export default function FunctionDiagnostics() {
  const stored = useMemo(loadStored, []);
  const [run, setRun] = useState<StoredRun>(() => stored ?? { model: selectedModel(), results: initialDiagnosticResults(selectedModel()) });
  const [hasRun, setHasRun] = useState(Boolean(stored));
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => { if (hasRun) saveStored(run); }, [run, hasRun]);

  const start = async () => {
    if (busy) return;
    const model = selectedModel();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setHasRun(true);
    setOpen(new Set());
    setRun({ model, startedAt: new Date().toISOString(), results: initialDiagnosticResults(model) });
    try {
      await runFunctionDiagnostics({
        provider: model,
        signal: controller.signal,
        basePath: import.meta.env.BASE_URL.replace(/\/$/, ""),
        onUpdate: (result) => {
          setRun((prev) => ({ ...prev, results: prev.results.map((r) => (r.id === result.id ? result : r)) }));
          if (result.status === "running") setOpen((prev) => (prev.has(result.id) ? prev : new Set(prev).add(result.id)));
        },
      });
    } finally {
      const stopped = controller.signal.aborted;
      setRun((prev) => ({
        ...prev,
        finishedAt: new Date().toISOString(),
        stopped,
        results: prev.results.map((r) => (stopped && r.status === "queued" ? { ...r, status: "cancelled", error: "Not started: the suite was stopped." } : r)),
      }));
      if (controllerRef.current === controller) controllerRef.current = null;
      setBusy(false);
    }
  };

  const stop = () => controllerRef.current?.abort();

  const download = () => {
    const report = {
      kind: "NEUROTEXT function diagnostics",
      generatedAt: new Date().toISOString(),
      model: run.model,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      stopped: Boolean(run.stopped),
      limits: { firstTextMs: FIRST_TEXT_LIMIT_MS, totalMs: TOTAL_TIME_LIMIT_MS },
      scope: "Basic format/content checks and streaming/speed measurements only. Not an expert literary-quality grade. Academic cases are bounded samples; no full thesis or dissertation was generated or verified.",
      counts,
      results: run.results,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neurotext-diagnostics-${(run.startedAt ?? new Date().toISOString()).replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const counts = useMemo(() => {
    const c = { queued: 0, running: 0, passed: 0, warning: 0, failed: 0, cancelled: 0, skipped: 0 };
    run.results.forEach((r) => { c[r.status]++; });
    return c;
  }, [run.results]);

  const allOpen = run.results.every((r) => open.has(r.id));
  const toggle = (id: string) => setOpen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const summary: { key: keyof typeof counts; label: string }[] = [
    { key: "queued", label: "Queued" }, { key: "running", label: "Running" }, { key: "passed", label: "Pass" },
    { key: "warning", label: "Warning" }, { key: "failed", label: "Fail" }, { key: "skipped", label: "Skipped" }, { key: "cancelled", label: "Stopped" },
  ];

  return (
    <main className="min-h-screen bg-white px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-6">
        <WritingNavigation current="diagnostics" busy={busy} />
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">Function diagnostics</h1>
          <p className="text-slate-700">
            Runs every writing function against the live model with a fixed test input, then sends each output back through a rewrite. Results are real responses; nothing is simulated.
          </p>
        </header>

        <section aria-label="What this suite checks" className="space-y-1 rounded-md border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
          <p><strong>What a pass means:</strong> the response completed, passed basic format and content checks (for example a scene heading, speaker turns, an exact replacement, an abstract), arrived as an incremental stream, showed first text within {FIRST_TEXT_LIMIT_MS / 1000} s and finished within {TOTAL_TIME_LIMIT_MS / 1000} s.</p>
          <p><strong>What it does not mean:</strong> these are not an expert literary or scholarly quality grade. Read the outputs yourself to judge quality.</p>
          <p><strong>Academic cases</strong> generate a short bounded sample (title, abstract, one paragraph). They do not generate or verify a full master's thesis or dissertation.</p>
          <p>A slow or buffered response is marked Warning, never Pass. A test that runs past 120 s is stopped and marked Fail with partial output kept.</p>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={start} disabled={busy} data-testid="button-run-diagnostics" className={`${btn} border-blue-700 bg-blue-700 text-white hover:bg-blue-800`}>
            {busy ? "Running diagnostics…" : "Run diagnostics"}
          </button>
          <button type="button" onClick={stop} disabled={!busy} data-testid="button-stop-diagnostics" className={`${btn} border-red-300 bg-white text-red-700 hover:bg-red-50`}>
            Stop
          </button>
          <button type="button" onClick={download} disabled={!hasRun || busy} data-testid="button-download-report" className={`${btn} border-slate-300 bg-white text-blue-700 hover:bg-blue-50`}>
            Download JSON report
          </button>
          <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(run.results.map((r) => r.id)))} data-testid="button-expand-all" className={`${btn} border-slate-300 bg-white text-blue-700 hover:bg-blue-50`}>
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>

        <div aria-live="polite" data-testid="text-run-meta" className="text-sm text-slate-600">
          {hasRun ? (
            <>Model <strong className="text-slate-900">{run.model}</strong>
              {run.startedAt && <> · started {new Date(run.startedAt).toLocaleString()}</>}
              {run.finishedAt && <> · finished {new Date(run.finishedAt).toLocaleString()}</>}
              {run.stopped && <> · <span className="font-semibold text-slate-900">stopped before completion</span></>}
              {!busy && !run.finishedAt && <> · <span className="font-semibold text-slate-900">interrupted by reload</span></>}
            </>
          ) : "No diagnostics have been run in this browser yet."}
        </div>

        <ul aria-label="Result counts" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {summary.map(({ key, label }) => (
            <li key={key} data-testid={`count-${key}`} className={`rounded-md border p-3 ${counts[key] ? STATUS_STYLE[key] : "border-slate-200 bg-white text-slate-500"}`}>
              <div className="text-2xl font-bold tabular-nums">{counts[key]}</div>
              <div className="text-xs font-semibold uppercase tracking-wide">{label}</div>
            </li>
          ))}
        </ul>

        <ol className="space-y-2">
          {run.results.map((row) => (
            <Row key={row.id} row={row} open={open.has(row.id)} onToggle={() => toggle(row.id)} />
          ))}
        </ol>
      </div>
    </main>
  );
}
