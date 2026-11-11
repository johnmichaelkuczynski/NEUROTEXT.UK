export interface AcademicPlan {
  title: string;
  chapters: string[];
}

export function academicChapterCount(functionId: number): number | null {
  return functionId === 9 ? 5 : functionId === 8 ? 4 : null;
}

export function academicWordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function cleanTitle(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 300 || /[\r\n]/.test(value)) {
    throw new Error("The selected provider returned an invalid academic title or chapter title.");
  }
  return value.trim();
}

export function parseAcademicPlan(text: string, chapterCount: number): AcademicPlan {
  const json = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try { value = JSON.parse(json); } catch {
    throw new Error("The selected provider did not return a usable title and chapter outline. No unstructured document was accepted.");
  }
  const plan = value as Partial<AcademicPlan> | null;
  if (!plan || !Array.isArray(plan.chapters) || plan.chapters.length !== chapterCount) {
    throw new Error(`The academic outline must contain exactly ${chapterCount} chapters.`);
  }
  const chapters = plan.chapters.map(cleanTitle);
  if (new Set(chapters.map(title => title.toLowerCase())).size !== chapterCount) {
    throw new Error("Each academic chapter must have a distinct title.");
  }
  return { title: cleanTitle(plan.title), chapters };
}

export function chapterHeading(plan: AcademicPlan, index: number): string {
  return `Chapter ${index + 1}: ${plan.chapters[index]}`;
}

export function academicFrontMatter(plan: AcademicPlan): string {
  return `${plan.title}\n\nTable of Contents\n\n${plan.chapters.map((_, index) => chapterHeading(plan, index)).join("\n")}\nReferences\n\n`;
}

export function academicPlanFromDocument(document: string, count: number): AcademicPlan {
  const match = document.match(/^([^\n]+)\n\nTable of Contents\n\n([\s\S]*?)\nReferences\n\n/);
  if (!match) throw new Error("This saved document has no structured academic outline. Start a new generation to apply the required chapter format.");
  const lines = match[2].split("\n");
  const chapters = lines.map((line, index) => {
    const prefix = `Chapter ${index + 1}: `;
    if (!line.startsWith(prefix)) throw new Error("The saved table of contents has invalid chapter numbering.");
    return line.slice(prefix.length);
  });
  return parseAcademicPlan(JSON.stringify({ title: match[1], chapters }), count);
}

export function academicSections(document: string, plan: AcademicPlan) {
  const frontMatter = academicFrontMatter(plan);
  if (!document.startsWith(frontMatter)) throw new Error("The title and table of contents no longer match the academic outline.");
  const body = document.slice(frontMatter.length);
  const headings = [...body.matchAll(/^Chapter (\d+): ([^\n]+)\n\n/gm)];
  headings.forEach((heading, index) => {
    if (Number(heading[1]) !== index + 1 || heading[2] !== plan.chapters[index]) {
      throw new Error("The generated document contains an extra, missing, or mismatched chapter.");
    }
  });
  const referencesAt = body.indexOf("\n\nReferences\n\n");
  const chapters = headings.map((heading, index) => {
    const start = heading.index! + heading[0].length;
    const end = headings[index + 1]?.index ?? (referencesAt >= 0 ? referencesAt : body.length);
    return body.slice(start, end);
  });
  return {
    chapters,
    references: referencesAt >= 0 ? body.slice(referencesAt + "\n\nReferences\n\n".length) : null,
  };
}

export function validateAcademicBody(text: string): void {
  // Chapter and front/back-matter boundaries belong to the application,
  // not to arbitrary provider continuation blocks.
  if (/^\s*(?:#{1,6}\s*)?(?:Chapter\s+(?:\d+|[IVX]+|One|Two|Three|Four|Five|Six)\b|Table of Contents\s*$|References\s*$|Bibliography\s*$|Works Cited\s*$)/im.test(text)) {
    throw new Error("The provider inserted an unexpected chapter or front/back-matter heading. The document was not marked complete.");
  }
}

export function validateAcademicDocument(document: string, plan: AcademicPlan): void {
  const sections = academicSections(document, plan);
  if (sections.chapters.length !== plan.chapters.length || sections.chapters.some(chapter => !chapter.trim())) {
    throw new Error(`The document must contain exactly ${plan.chapters.length} nonempty chapters.`);
  }
  if (!sections.references?.trim()) throw new Error("The academic document is missing its final references.");
  sections.chapters.forEach(validateAcademicBody);
  validateAcademicBody(sections.references);
}
