export default function WritingNavigation({ current, busy }: { current: "creator" | "transformer" | "screenplay" | "screenplay-adaptation" | "dialogue" | "dialogue-adaptation" | "coherence" | "maxintel"; busy: boolean }) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <nav aria-label="Writing pages" className="flex flex-wrap gap-3">
      {([
        { id: "creator", path: "/page-2", label: "Write from scratch" },
        { id: "transformer", path: "/page-3", label: "Document transformer" },
        { id: "screenplay", path: "/page-4", label: "Screenplay generator" },
        { id: "screenplay-adaptation", path: "/page-5", label: "Text to screenplay" },
        { id: "dialogue", path: "/page-6", label: "Dialogue creator" },
        { id: "dialogue-adaptation", path: "/page-7", label: "Text to dialogue" },
        { id: "coherence", path: "/page-8", label: "Coherence evaluator" },
        { id: "maxintel", path: "/page-9", label: "Maximum intelligence rewrite" },
      ] as const).map((page) => (
        <a
          key={page.id}
          href={`${base}${page.path}`}
          aria-current={current === page.id ? "page" : undefined}
          aria-disabled={busy || undefined}
          onClick={(event) => {
            if (busy || current === page.id) event.preventDefault();
          }}
          className={`rounded-md border px-4 py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 ${current === page.id ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-blue-700 hover:bg-blue-50"} ${busy ? "cursor-not-allowed opacity-60" : ""}`}
        >
          {page.label}
        </a>
      ))}
    </nav>
  );
}
