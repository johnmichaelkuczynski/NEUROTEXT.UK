export const DISSERTATION_MAX_WORDS = 45_000;

export function isDissertationPage(functionId: string) {
  return functionId === "dissertation-creator" || functionId === "dissertation-transformer" || functionId === "dissertation-revision";
}

export function dissertationRequestError(input: {
  functionId: string;
  targetWords?: string;
  instructions?: string;
  text: string;
  resumeDocument?: string;
}): string | null {
  if (!isDissertationPage(input.functionId)) return null;
  const target = input.targetWords?.trim().replace(/,/g, "") ?? "";
  if (!/^\d+$/.test(target) || Number(target) < 1 || Number(target) > DISSERTATION_MAX_WORDS) {
    return "Specify a dissertation length between 1 and 45,000 words.";
  }
  if (!input.instructions?.trim()) return "Describe the dissertation you want created.";
  if (input.functionId === "dissertation-transformer" && !input.text.trim()) {
    return "Paste or upload the text you want transformed into a dissertation.";
  }
  if (input.functionId === "dissertation-revision" && !input.text.trim()) {
    return "Generate a dissertation before requesting a revision.";
  }
  if ((input.resumeDocument?.match(/\S+/g)?.length ?? 0) > DISSERTATION_MAX_WORDS) {
    return "The saved dissertation exceeds the 45,000-word maximum.";
  }
  return null;
}
