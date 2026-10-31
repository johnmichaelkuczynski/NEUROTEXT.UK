/** Count document words, not standalone Markdown formatting or punctuation. */
export function countOutputWords(text: string): number {
  return text.match(/\S+/gu)?.filter(word => /[\p{L}\p{N}]/u.test(word)).length ?? 0;
}
