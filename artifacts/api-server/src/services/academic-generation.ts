import type { StreamInput } from "@workspace/api-zod";
import { DOCUMENT_SYSTEM_PROMPT, documentInputSection } from "./document-inputs";
import {
  academicChapterCount, academicFrontMatter, academicPlanFromDocument,
  academicSections, academicWordCount, chapterHeading, parseAcademicPlan,
  validateAcademicBody, validateAcademicDocument,
} from "./academic-structure";

type Generate = (system: string, prompt: string, onContent: (text: string) => void, maxTokens?: number) => Promise<void>;

export async function generateAcademicDocument(options: {
  data: StreamInput;
  generate: Generate;
  emit: (text: string) => void;
  isClosed: () => boolean;
  status: (message: string) => void;
}): Promise<void> {
  const { data, generate, isClosed, status } = options;
  const count = academicChapterCount(data.functionId);
  if (!count) throw new Error("This function does not use the academic chapter workflow.");
  const kind = data.functionId === 9 ? "dissertation" : "master's thesis";
  let document = data.resumeFrom || "";
  const emit = (text: string) => {
    if (isClosed()) return;
    document += text;
    options.emit(text);
  };
  let plan;
  if (document) {
    plan = academicPlanFromDocument(document, count);
  } else {
    status("Preparing the title and table of contents");
    let outline = "";
    await generate(
      DOCUMENT_SYSTEM_PROMPT,
      `Create the title and chapter outline for a ${kind} with exactly ${count} substantive chapters.
${documentInputSection(data)}
Return only JSON: {"title":"subject-specific academic title","chapters":["chapter title", "..."]}.
The chapters array must have exactly ${count} distinct titles, without chapter numbers or markdown.
Organize the manuscript's actual intellectual content into these chapters. The first chapter introduces the central problem and thesis; the last develops the concluding synthesis. Adapt the middle chapters to the actual subject and argument; never invent experiments, participants, data or empirical methods for a theoretical work.
Do not list references as a chapter. No prose, commentary or code fences.`,
      text => { outline += text; },
      1500,
    );
    if (isClosed()) return;
    plan = parseAcademicPlan(outline, count);
    emit(academicFrontMatter(plan));
  }
  const frontWords = academicWordCount(academicFrontMatter(plan));
  const referenceBudget = Math.min(1000, Math.max(150, Math.round(data.targetWords * 0.02)));
  const chapterTotal = Math.max(count, data.targetWords - frontWords - referenceBudget);
  const budgets = plan.chapters.map((_, index) =>
    Math.floor(chapterTotal / count) + (index < chapterTotal % count ? 1 : 0));
  const outline = plan.chapters.map((_, index) => chapterHeading(plan, index)).join("\n");
  let sections = academicSections(document, plan);

  for (let index = 0; index < count; index++) {
    if (isClosed()) return;
    if (index < sections.chapters.length - 1 || sections.references !== null) continue;
    status(`Writing chapter ${index + 1} of ${count}`);
    if (sections.chapters[index] === undefined) emit(`${index ? "\n\n" : ""}${chapterHeading(plan, index)}\n\n`);
    let chapter = sections.chapters[index] || "";
    let blocks = 0;
    while (academicWordCount(chapter) < budgets[index] && !isClosed()) {
      if (++blocks > Math.ceil(budgets[index] / 400) + 8) {
        throw new Error(`Chapter ${index + 1} did not reach its planned length. The document was not marked complete.`);
      }
      const remaining = budgets[index] - academicWordCount(chapter);
      const finalBlock = remaining <= 1700;
      const blockWords = finalBlock ? remaining : Math.min(1500, remaining);
      let block = "";
      if (chapter.trim()) { emit("\n\n"); chapter += "\n\n"; }
      await generate(
        DOCUMENT_SYSTEM_PROMPT,
        `Write finished prose for chapter ${index + 1} of this ${kind}, not an outline or writing guide.
${documentInputSection(data)}
Title: ${plan.title}
Fixed table of contents:
${outline}
CURRENT CHAPTER: ${chapterHeading(plan, index)}
This chapter's target is approximately ${budgets[index]} words. Add approximately ${blockWords} words now.
${data.thinker && data.thinker !== "Standard NEUROTEXT style" ? `Use the intellectual perspective of ${data.thinker}, without fabricated quotations.` : ""}
Write only this chapter's body. The application already supplies the title, contents and chapter headings. Do not repeat them, start another chapter, or add References, Bibliography, Works Cited or other back matter. Useful numbered subsections such as ${index + 1}.1 are allowed.
${finalBlock
  ? index === count - 1
    ? "Complete this final chapter with the dissertation/thesis's substantive concluding synthesis. Do not append the bibliography; it will be generated separately."
    : "Bring this chapter's argument to a coherent close without concluding the entire work or beginning the next chapter."
  : "Develop this chapter's argument in depth. Do not conclude the chapter or the whole work yet."}
Preserve the manuscript's central thesis, terminology and complex system of thought. Cite only legitimate scholarly works you can accurately identify; never invent quotations, research, results or source details.
${chapter.trim() ? `Continue this chapter without repeating its opening. Recent chapter text:\n${chapter.slice(-9000)}` : `Begin this chapter's opening prose, building on previous chapters without repeating them.`}
${index ? `Recent preceding document context:\n${document.slice(0, document.lastIndexOf(chapterHeading(plan, index))).slice(-5000)}` : ""}
Keep paragraphs readable and finish complete sentences.`,
        text => { block += text; emit(text); },
      );
      if (isClosed()) return;
      validateAcademicBody(block);
      if (!block.trim() || (remaining > 100 && academicWordCount(block) < 80)) {
        throw new Error(`The provider stopped before completing substantive text in chapter ${index + 1}.`);
      }
      chapter += block;
    }
    sections = academicSections(document, plan);
  }

  if (isClosed()) return;
  if (sections.references === null || !sections.references.trim()) {
    status("Preparing the final references");
    if (sections.references === null) emit("\n\nReferences\n\n");
    let references = "";
    await generate(
      DOCUMENT_SYSTEM_PROMPT,
      `Write only the reference entries for the ${kind} below, with no heading or other prose.
Match the author-date citations actually used in the chapters. Include only legitimate works whose bibliographic details you can identify accurately. Never invent sources, authors, dates, titles, URLs, quotations or findings. Use APA 7 formatting. Do not write new chapters, an appendix or a conclusion. References are the final section, outside the ${count} chapters.
Supporting reference material: ${JSON.stringify(data.sourceDocument || "")}
Document to reference:\n${document}`,
      text => { references += text; emit(text); },
    );
    if (isClosed()) return;
    validateAcademicBody(references);
  }
  validateAcademicDocument(document, plan);
}
