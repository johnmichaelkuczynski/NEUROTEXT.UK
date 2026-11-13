export const MAX_LIBRARY_PAGES = 10_000;
export const MAX_LIBRARY_BYTES = 50 * 1024 * 1024;
export const MAX_REFERENCE_WORDS = 20_000;
export const MAX_REFERENCE_CHARACTERS = 120_000;
export const countWords = (text: string) => text.trim() ? text.trim().split(/\s+/u).length : 0;
export function referenceLimitError(text: string): string | null {
  return countWords(text) > MAX_REFERENCE_WORDS || text.length > MAX_REFERENCE_CHARACTERS
    ? "Use no more than 20,000 words or 120,000 characters of supporting material at a time (about 40 pages at 500 words per page). Select a shorter text or relevant excerpts; the app does not silently truncate your material."
    : null;
}
export function libraryCharge(text: string, format: "txt" | "doc" | "pdf", originalBytes: number) {
  const words = countWords(text);
  const pages = Math.max(1, Math.ceil(words / 500));
  const weight = { txt: 1, doc: 2, pdf: 4 }[format];
  return {
    words, pages, chargedPages: pages * weight,
    chargedBytes: Math.max(Buffer.byteLength(text, "utf8"), originalBytes) * weight,
  };
}
