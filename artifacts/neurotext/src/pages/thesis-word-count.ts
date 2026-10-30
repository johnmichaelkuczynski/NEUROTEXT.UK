export const MAX_THESIS_WORDS = 20000;

export type WordCountResult = { ok: true; words: number } | { ok: false; reason: "missing" | "invalid" | "over" };

const UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

function wordsToNumber(phrase: string): number | undefined {
  const parts = phrase.toLowerCase().replace(/-/g, " ").split(/\s+/).filter((p) => p && p !== "and");
  if (!parts.length) return undefined;
  let total = 0;
  let current = 0;
  for (const p of parts) {
    if (p in UNITS) current += UNITS[p];
    else if (p === "hundred") current = (current || 1) * 100;
    else if (p === "thousand") { total += (current || 1) * 1000; current = 0; }
    else return undefined;
  }
  return total + current;
}

function numericValue(raw: string, suffix?: string): number {
  const n = Number(raw.replace(/,/g, ""));
  return suffix && /k/i.test(suffix) ? n * 1000 : n;
}

const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(k)?`;
const NATURAL = String.raw`((?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and)[\s-]+)*(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand))`;

/** Parse an explicit length request. Only phrasing tied to "words"/"length"/"word count" counts. */
export function parseThesisWordCount(text: string, maximumWords = MAX_THESIS_WORDS): WordCountResult {
  const patterns: Array<{ re: RegExp; natural?: boolean }> = [
    { re: new RegExp(String.raw`\b(?:word\s*count|length|target(?:\s+length)?)\s*[:=]?\s*(?:of\s+|is\s+|approximately\s+|about\s+|~\s*)?` + NUM + String.raw`(?:\s*-?\s*words?)?\b`, "i") },
    { re: new RegExp(String.raw`(?<![\w.,+-])` + NUM + String.raw`\s*-?\s*words?\b`, "i") },
    { re: new RegExp(String.raw`\b` + NATURAL + String.raw`[\s-]+words?\b`, "i"), natural: true },
  ];
  let found = false;
  for (const { re, natural } of patterns) {
    const m = text.match(re);
    if (!m) continue;
    found = true;
    const n = natural ? wordsToNumber(m[1]) : numericValue(m[1], m[2]);
    if (n === undefined || !Number.isFinite(n) || !Number.isInteger(n) || n < 1) return { ok: false, reason: "invalid" };
    if (n > maximumWords) return { ok: false, reason: "over" };
    return { ok: true, words: n };
  }
  if (!found && /\b(word\s*count|length)\s*[:=]/i.test(text)) return { ok: false, reason: "invalid" };
  return { ok: false, reason: "missing" };
}

export function wordCountError(r: WordCountResult, maximumWords = MAX_THESIS_WORDS): string {
  if (r.ok) return "";
  if (r.reason === "over") return `The requested length exceeds the ${maximumWords.toLocaleString()}-word maximum. Specify a word count of ${maximumWords.toLocaleString()} words or fewer.`;
  if (r.reason === "invalid") return "The word count could not be recognized. Write a whole number, for example \"15,000 words\" or \"word count: 12000\".";
  return `Specify a word count in the instructions, for example "15,000 words" (maximum ${maximumWords.toLocaleString()}).`;
}
