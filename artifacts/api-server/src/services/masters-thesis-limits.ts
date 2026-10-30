export const MASTER_THESIS_MAX_WORDS = 20_000;

export function isMastersThesisPage(functionId: string) {
  return functionId === "thesis-creator" || functionId === "thesis-transformer" || functionId === "thesis-revision";
}

export function mastersThesisRequestError(input: {
  functionId: string;
  targetWords?: string;
  instructions?: string;
  text: string;
  resumeDocument?: string;
}): string | null {
  if (!isMastersThesisPage(input.functionId)) return null;
  const target = input.targetWords?.trim().replace(/,/g, "") ?? "";
  if (!/^\d+$/.test(target) || Number(target) < 1 || Number(target) > MASTER_THESIS_MAX_WORDS) {
    return "Specify a thesis length between 1 and 20,000 words.";
  }
  if (!input.instructions?.trim()) return "Describe the master's thesis you want created.";
  if (input.functionId === "thesis-transformer" && !input.text.trim()) {
    return "Paste or upload the text you want transformed into a master's thesis.";
  }
  if (input.functionId === "thesis-revision" && !input.text.trim()) {
    return "Generate a thesis before requesting a revision.";
  }
  if ((input.resumeDocument?.match(/\S+/g)?.length ?? 0) > MASTER_THESIS_MAX_WORDS) {
    return "The saved thesis exceeds the 20,000-word maximum.";
  }
  return null;
}
