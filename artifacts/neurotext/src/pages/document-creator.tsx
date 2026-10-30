import { useState } from "react";

function OptionalMaterial({ label, id }: { label: string; id: string }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-base font-semibold">
        {label} <span className="font-normal text-slate-500">(optional)</span>
      </label>
      <div className="rounded-md border border-slate-300 bg-white">
        <textarea
          id={id}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={`Paste ${label.toLowerCase()} or choose a file below.`}
          className="block min-h-32 w-full resize-y rounded-md p-3 text-base outline-none focus:ring-2 focus:ring-blue-600"
        />
        <input
          type="file"
          aria-label={`Upload ${label.toLowerCase()}`}
          className="block w-full border-t border-slate-200 p-3 text-sm file:mr-3 file:rounded file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5"
          onChange={async (event) => {
            const selected = event.target.files?.[0] ?? null;
            setFile(selected);
            setError("");
            if (selected && (selected.type.startsWith("text/") || /\.(txt|md)$/i.test(selected.name))) {
              try {
                setText(await selected.text());
              } catch {
                setError("This file could not be read. Paste the text instead.");
              }
            }
          }}
        />
      </div>
      {file && <span className="sr-only">{file.name} selected</span>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

export default function DocumentCreator() {
  const [instructions, setInstructions] = useState("");

  return (
    <main className="min-h-screen bg-white px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold">Document creator</h1>
        <textarea
          aria-label="What do you want created?"
          placeholder="What do you want created?"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          className="block min-h-40 w-full resize-y rounded-md border border-slate-300 p-3 text-base outline-none focus:ring-2 focus:ring-blue-600"
        />
        <OptionalMaterial id="style-sample" label="Style sample" />
        <OptionalMaterial id="content-source" label="Content source" />
      </div>
    </main>
  );
}
