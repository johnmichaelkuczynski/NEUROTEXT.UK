import { useEffect, useId, useState } from "react";

export const MODEL_OPTIONS = ["ZHI 1", "ZHI 2", "ZHI 3", "ZHI 4"] as const;
const KEY = "neurotext-selected-llm";
const EVENT = "neurotext-model-changed";
type Model = typeof MODEL_OPTIONS[number];

export function getSelectedModel(): Model {
  try {
    const stored = localStorage.getItem(KEY);
    if (MODEL_OPTIONS.includes(stored as Model)) return stored as Model;
  } catch { /* Storage can be unavailable in private browsing. */ }
  return "ZHI 1";
}

let inMemoryModel: Model | undefined;
export function selectedModel(): Model {
  return inMemoryModel ?? getSelectedModel();
}

export default function ModelSelector({ busy }: { busy: boolean }) {
  const [model, setModel] = useState(selectedModel);
  const id = useId();
  useEffect(() => {
    const sync = () => setModel(selectedModel());
    const storage = () => { inMemoryModel = undefined; sync(); };
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", storage); };
  }, []);
  return (
    <label htmlFor={id} className="flex items-center gap-3 font-semibold">
      LLM
      <select
        id={id}
        aria-label="LLM"
        data-testid="select-llm"
        value={model}
        disabled={busy}
        onChange={(event) => {
          const next = event.target.value as Model;
          inMemoryModel = next;
          try { localStorage.setItem(KEY, next); } catch { /* Keep the selection in memory. */ }
          setModel(next);
          window.dispatchEvent(new Event(EVENT));
        }}
        className="h-11 rounded-md border border-slate-300 bg-white px-3 text-base font-normal text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {MODEL_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}
