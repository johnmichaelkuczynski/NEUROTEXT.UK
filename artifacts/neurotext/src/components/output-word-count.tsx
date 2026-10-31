import { useMemo } from "react";
import { countOutputWords } from "@/lib/output-word-count";

export default function OutputWordCount({ text }: { text: string }) {
  const count = useMemo(() => countOutputWords(text), [text]);
  return (
    <span data-testid="output-word-count" className="ml-3 inline-block whitespace-nowrap text-sm font-normal tabular-nums text-slate-600">
      {count.toLocaleString()} {count === 1 ? "word" : "words"}
    </span>
  );
}
