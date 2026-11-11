const CHAPTER_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
export function chapterNumber(text: string): number | null {
  const match = text.match(/^Chapter\s+(\d+|One|Two|Three|Four|Five|IV|III|II|V|I)\b/i);
  return match ? Number(match[1]) || CHAPTER_NUMBERS[match[1].toLowerCase()] || null : null;
}

export function contentsEntries(text: string): string[] {
  return text.split(/\r?\n|(?=\bChapter\s+(?:\d+|One|Two|Three|Four|Five|IV|III|II|V|I)\b)/i)
    .map(line => line.trim()).filter(Boolean);
}

export function normalizeAcademicContents(text: string): string {
  const paragraphs = text.split(/\n\s*\n/);
  const index = paragraphs.findIndex(paragraph => /^Table of Contents$/i.test(paragraph.trim()));
  if (index >= 0 && paragraphs[index + 1]) {
    paragraphs[index + 1] = contentsEntries(paragraphs[index + 1]).join('\n');
  }
  return paragraphs.join('\n\n');
}
