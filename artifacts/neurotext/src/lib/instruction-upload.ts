const MAX_INSTRUCTION_FILE_BYTES = 10 * 1024 * 1024;

export async function readInstructionFile(file: File): Promise<string> {
  if (!/\.(txt|md|markdown)$/i.test(file.name) && !file.type.startsWith('text/')) {
    throw new Error('Upload a .txt or .md file. For Word or PDF documents, export as plain text first.');
  }
  if (file.size > MAX_INSTRUCTION_FILE_BYTES) {
    throw new Error('The draft must be 10 MB or smaller.');
  }
  const text = (await file.text()).replace(/^\uFEFF/, '').trim();
  if (!text) throw new Error('This file is empty. Choose a draft containing text.');
  if (text.includes('\u0000')) {
    throw new Error('This file is not readable plain text. Export the document as .txt first.');
  }
  return text;
}

export function appendInstructionDraft(instructions: string, draft: string): string {
  const task = instructions.trim()
    ? instructions
    : 'Polish and develop the dissertation draft below, preserving its central arguments, terminology, and system of thought.';
  return `${task}\n\nDissertation draft to revise (not reference material):\n${draft}`;
}
