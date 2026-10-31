import type { GenerationOptions, GenerationResult, generateWithFallback } from "./llm-router.ts";
import {
  splitTranslationText, translationPartPrompt, translationSeparator, translationWordTarget,
  mergeTranslationTerminology, translationTerminologyPrompt, type TranslationTerm,
} from "./translation.ts";

type StreamEvent = { type: string; [key: string]: unknown };
type Generate = (
  provider: string, prompt: string,
  onToken: (token: string, providerUsed: string) => void,
  options: GenerationOptions,
) => Promise<GenerationResult>;

const wordCount = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;

// Kept separate from academic generation: a partial translation has no safe
// source boundary from which to resume automatically.
export async function streamTranslation(
  input: { text: string; instructions?: string; provider: string; revision: boolean; translationTerminology?: TranslationTerm[] },
  generate: Generate,
  emit: (event: StreamEvent) => void,
  isClosed: () => boolean,
  tracking?: {
    extract: typeof generateWithFallback;
    warning: (index: number) => void;
  },
) {
  const { text, instructions, provider, revision } = input;
  const parts = splitTranslationText(text);
  const requestedWords = translationWordTarget(instructions, wordCount(text), revision, text);
  // A fresh translation never inherits another document's terminology.
  let terminology = revision ? input.translationTerminology ?? [] : [];
  let translation = "";
  for (let index = 0; index < parts.length; index++) {
    if (isClosed()) return;
    const source = parts[index];
    if (!source.trim()) continue;
    const separator = translation ? translationSeparator(parts[index - 1] ?? "", source) : "";
    const partTarget = requestedWords ? Math.max(1, Math.round(requestedWords * source.length / Math.max(1, text.length))) : undefined;
    emit({ type: "section_start", index, total: parts.length, separator });
    const prompt = translationPartPrompt({
      revision, instructions, source, index, total: parts.length,
      proportion: source.length / Math.max(1, text.length), previousTranslation: translation, targetWords: partTarget, terminology,
    });
    let result;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) emit({ type: "replace_output", text: translation + separator });
      result = await generate(provider, prompt + (attempt ? "\nThe preceding attempt missed the length requirement. Recount and meet the stated word target." : ""), (token, providerUsed) => {
        emit({ type: "token", index, total: parts.length, text: token, providerUsed });
      }, { quotes: 0, maxWords: Math.min(8000, Math.max(2400, Array.from(source).length * 2)) });
      // Check before length retries: never erase a cutoff's partial tokens or
      // acknowledge its section, and never advance to the next source part.
      if (result.truncated || result.completion === "incomplete") {
        emit({
          type: "error", code: "translation_incomplete", index, total: parts.length,
          finishReason: result.finishReason,
          message: result.truncated
            ? "The translation is incomplete because the model reached its output limit. All partial text is preserved. Retry with a smaller source selection."
            : "The translation provider stopped before completing this part. All partial text is preserved but incomplete. Retry the translation.",
        });
        return;
      }
      if (!partTarget || Math.abs(wordCount(result.text) - partTarget) <= Math.max(3, Math.ceil(partTarget * 0.1))) break;
      if (attempt === 1) {
        emit({ type: "error", message: "The translation did not meet your requested length. Partial output is preserved; adjust the instructions or retry." });
        return;
      }
    }
    if (!result) throw new Error("No translation was generated.");
    if (!result.text.trim()) throw new Error("The translation provider returned no text.");
    translation += separator + result.text;
    emit({ type: "section_done", index, total: parts.length, generatedWords: wordCount(result.text) });
    if (tracking) {
      // Auxiliary learning must never erase accepted text or make it non-resumable.
      let learned = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (isClosed()) return;
        try {
          const extracted = await tracking.extract(provider, translationTerminologyPrompt({
            source, output: result.text, instructions, terminology, revision,
          }), { quotes: 0, maxWords: 2400 });
          if (extracted.truncated || extracted.completion === "incomplete") continue;
          terminology = mergeTranslationTerminology(terminology, extracted.text, source, result.text, revision);
          learned = true;
          break;
        } catch {
          // Retry only extraction; keep the last valid map if both attempts fail.
        }
      }
      if (!learned) {
        tracking.warning(index);
        emit({
          type: "translation_terminology_warning",
          message: "Terminology tracking could not update for part of this translation. Previously established terms were retained; review terminology in the completed text.",
        });
      }
      emit({ type: "translation_terminology", terms: terminology });
    }
  }
  emit({ type: "done", generatedWords: wordCount(translation) });
}
