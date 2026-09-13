export const LONG_FORM_BLOCK_WORDS = 1000;

export type LongFormQualityResult = {
  passed: boolean;
  failures: string[];
  generatedWords: number;
  minimumWords: number;
};

export function countWords(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function trimToWordCountPreservingFormatting(value: string, targetWords: number) {
  const matches = [...value.matchAll(/\S+/g)];
  if (matches.length <= targetWords) return value.trim();
  const finalWord = matches[targetWords - 1];
  const end = (finalWord.index ?? 0) + finalWord[0].length;
  return value.slice(0, end).trim();
}

export function wordTargetBounds(targetWords: number) {
  const margin = targetWords >= 10000 ? 0.02 : targetWords >= 1000 ? 0.05 : 0.1;
  return {
    minimumWords: Math.ceil(targetWords * (1 - margin)),
    maximumWords: Math.floor(targetWords * (1 + margin)),
    margin,
  };
}

export function planLongFormBlocks(targetWords: number, blockWords = LONG_FORM_BLOCK_WORDS) {
  const minimumWords = targetWords;
  const blocks: number[] = [];
  let plannedWords = 0;
  while (plannedWords < minimumWords) {
    const remainingWords = minimumWords - plannedWords;
    const nextBlock = Math.min(blockWords, Math.max(80, remainingWords));
    blocks.push(nextBlock);
    plannedWords += nextBlock;
  }
  return { minimumWords, blocks };
}

export function createPlanStartEvent(targetWords: number, total: number) {
  return { type: "plan_start" as const, targetWords, total };
}

export function createSectionStartEvent({
  index,
  total,
  generatedWords,
  targetWords,
}: {
  index: number;
  total: number;
  generatedWords: number;
  targetWords: number;
}) {
  return {
    type: "section_start" as const,
    index,
    total,
    maxWords: LONG_FORM_BLOCK_WORDS,
    generatedWords,
    targetWords,
  };
}

function normalizeParagraph(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

function repeatedParagraphs(document: string) {
  const seen = new Set<string>();
  const repeats: string[] = [];
  for (const paragraph of document.split(/\n\s*\n/)) {
    const normalized = normalizeParagraph(paragraph);
    if (countWords(normalized) < 20) continue;
    if (seen.has(normalized)) repeats.push(paragraph.trim());
    seen.add(normalized);
  }
  return repeats;
}

function citationMarkers(value: string) {
  const markers = new Set<string>();
  const patterns = [
    /\([A-Z][\p{L}'’-]+(?:\s+(?:and|&)\s+[A-Z][\p{L}'’-]+)?,\s*(?:19|20)\d{2}[a-z]?(?:,\s*p{1,2}\.\s*\d+(?:-\d+)?)?\)/gu,
    /\[[1-9]\d{0,2}\]/g,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) markers.add(match[0].replace(/\s+/g, " "));
  }
  return markers;
}

function thesisTerms(thesis: string) {
  const stopWords = new Set(["about", "after", "again", "also", "because", "before", "being", "between", "could", "does", "from", "have", "into", "only", "should", "than", "that", "their", "there", "these", "this", "through", "under", "which", "while", "with", "would"]);
  return [...new Set(
    thesis.toLowerCase()
      .match(/[\p{L}\p{N}'’-]+/gu)
      ?.filter((word) => word.length >= 5 && !stopWords.has(word)) ?? [],
  )];
}

function thesisPresent(section: string, thesis: string) {
  const terms = thesisTerms(thesis);
  if (!terms.length) return true;
  const normalized = section.toLowerCase();
  const matches = terms.filter((term) => normalized.includes(term)).length;
  return matches / terms.length >= 0.6;
}

export function validateLongFormDocument({
  document,
  source,
  evidence,
  targetWords,
  nonNegotiableThesis,
  requireScholarlyApparatus = false,
}: {
  document: string;
  source: string;
  evidence?: string;
  targetWords: number;
  nonNegotiableThesis?: string;
  requireScholarlyApparatus?: boolean;
}): LongFormQualityResult {
  const generatedWords = countWords(document);
  const { minimumWords, maximumWords } = wordTargetBounds(targetWords);
  const failures: string[] = [];
  if (generatedWords < minimumWords || generatedWords > maximumWords) {
    failures.push(`Output has ${generatedWords} words; the acceptable range is ${minimumWords}-${maximumWords} words for a ${targetWords}-word request.`);
  }

  if (repeatedParagraphs(document).length) failures.push("Output contains a repeated paragraph.");
  if (/\b(?:CONFLICT_FLAG|ANTI-SYCOPHANCY CONTRACT|PERMITTED CITATION|VERIFIED SCHOLARLY METADATA|OPENING BLOCK INSTRUCTION|GLOBAL SKELETON)\b/i.test(document)) {
    failures.push("Output exposes internal generation or validation instructions.");
  }

  const sourceCitations = citationMarkers(`${source}\n${evidence ?? ""}`);
  const documentCitations = citationMarkers(document);
  const inventedCitations = [...documentCitations].filter((marker) => !sourceCitations.has(marker));
  if (inventedCitations.length) failures.push(`Output contains unsupported citation markers: ${inventedCitations.join(", ")}.`);
  if (requireScholarlyApparatus && documentCitations.size === 0) failures.push("Scholarly output has no supported in-text citations.");
  if (requireScholarlyApparatus && !/(?:^|\n)\s*(?:References|Bibliography)\s*(?:\n|$)/i.test(document)) {
    failures.push("Scholarly output has no References or Bibliography section.");
  }

  if (nonNegotiableThesis?.trim()) {
    const words = document.trim().split(/\s+/);
    const third = Math.max(1, Math.floor(words.length / 3));
    const sections = [
      ["opening", words.slice(0, third).join(" ")],
      ["middle", words.slice(third, third * 2).join(" ")],
      ["conclusion", words.slice(third * 2).join(" ")],
    ] as const;
    for (const [name, section] of sections) {
      if (!thesisPresent(section, nonNegotiableThesis)) failures.push(`The ${name} does not preserve the non-negotiable thesis.`);
    }
  }

  return { passed: failures.length === 0, failures, generatedWords, minimumWords };
}

export function extractNonNegotiableThesis(instructions?: string) {
  if (!instructions) return undefined;
  const match = instructions.match(/(?:non-negotiable|nonnegotiable)\s+thesis\s*:\s*(.+?)(?:\n\s*\n|$)/is);
  return match?.[1]?.trim();
}