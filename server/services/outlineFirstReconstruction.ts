/**
 * Outline-First Reconstruction Service
 * 
 * For long documents, this approach:
 * 1. First extracts a strict structural outline from the entire document
 * 2. Uses that outline to guide coherent reconstruction section-by-section
 * 3. Ensures global coherence by having each section reference the master outline
 * 
 * This solves the "Frankenstein problem" where chunk-by-chunk reconstruction
 * leads to incoherent outputs with contradictions and drift.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

interface OutlineSection {
  id: string;
  title: string;
  keyPoints: string[];
  subsections: string[];  // Subsection titles within this section
  dependencies: string[];  // Which other sections this depends on
  paragraphRange: { start: number; end: number };  // Which paragraphs this section covers
}

interface DocumentOutline {
  thesis: string;
  sections: OutlineSection[];
  keyTerms: { term: string; definition: string }[];
  globalConstraints: string[];  // Things that must be true throughout
  logicalFlow: string;  // How the argument progresses
}

interface ReconstructionResult {
  reconstructedText: string;
  outline: DocumentOutline;
  sectionOutputs: { sectionId: string; content: string }[];
  processingStats: {
    inputWords: number;
    outputWords: number;
    sectionsProcessed: number;
    timeMs: number;
  };
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic();

/**
 * Split text into paragraphs for section mapping
 */
function splitIntoParagraphs(text: string): string[] {
  return text.split(/\n\n+/).filter(p => p.trim().length > 0);
}

/**
 * Estimate tokens for a text (rough approximation: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract a strict structural outline from the document
 * Uses chunked approach for very long documents
 */
async function extractStrictOutline(
  text: string,
  paragraphs: string[],
  customInstructions?: string
): Promise<DocumentOutline> {
  console.log("[Outline-First] Extracting strict outline...");
  
  // For very long documents, we need to be smart about what we send
  // Claude's context is ~200k tokens, but we want to leave room for output
  const MAX_INPUT_CHARS = 150000; // ~37k tokens, leaving room for prompt + output
  
  let documentPreview: string;
  if (text.length > MAX_INPUT_CHARS) {
    // For very long docs, send first and last portions with summary of middle
    const firstPart = text.substring(0, 60000);
    const lastPart = text.substring(text.length - 40000);
    documentPreview = `${firstPart}\n\n[... DOCUMENT CONTINUES - ${paragraphs.length} total paragraphs ...]\n\n${lastPart}`;
    console.log(`[Outline-First] Document truncated for outline extraction: ${text.length} chars -> ${documentPreview.length} chars`);
  } else {
    documentPreview = text;
  }
  
  // Create compact paragraph reference (just first 100 chars, limit to first 100 paragraphs for very long docs)
  const maxParagraphsToShow = Math.min(paragraphs.length, 100);
  const paragraphSummary = paragraphs.slice(0, maxParagraphsToShow).map((p, i) => 
    `[P${i}] ${p.substring(0, 80).replace(/\n/g, ' ')}...`
  ).join('\n');
  
  const prompt = `You are analyzing a document to extract its strict structural outline for a FORMAL ACADEMIC DOCUMENT.

THE DOCUMENT HAS ${paragraphs.length} PARAGRAPHS TOTAL.
${paragraphs.length > maxParagraphsToShow ? `(Showing first ${maxParagraphsToShow} paragraph previews)` : ''}

PARAGRAPH PREVIEWS:
${paragraphSummary}

DOCUMENT CONTENT:
${documentPreview}

TASK: Extract a detailed structural outline for a COMPLETE ACADEMIC DOCUMENT.
The output MUST follow this MANDATORY STRUCTURE:

1. ABSTRACT - Brief summary of the entire work (200-400 words)
2. INTRODUCTION - Context, problem statement, thesis, and roadmap
3. LITERATURE REVIEW - Survey of relevant prior work and scholarship
4. SUBSTANTIVE CHAPTERS (3-7 chapters depending on document length) - The main content
5. CONCLUSION - Summary of findings, implications, and future directions

Each chapter MUST have 2-4 internal subsections with clear headings.

Return a JSON object with this EXACT structure:
{
  "thesis": "Central claim or purpose in one sentence",
  "sections": [
    {
      "id": "abstract",
      "title": "Abstract",
      "keyPoints": ["Main finding 1", "Main finding 2"],
      "subsections": [],
      "dependencies": [],
      "paragraphRange": {"start": 0, "end": 1}
    },
    {
      "id": "introduction",
      "title": "Introduction",
      "keyPoints": ["Context", "Problem", "Thesis", "Roadmap"],
      "subsections": ["Background", "Problem Statement", "Thesis and Approach"],
      "dependencies": [],
      "paragraphRange": {"start": 1, "end": 3}
    },
    {
      "id": "literature_review",
      "title": "Literature Review",
      "keyPoints": ["Prior work overview"],
      "subsections": ["Historical Context", "Contemporary Debates", "Research Gap"],
      "dependencies": ["introduction"],
      "paragraphRange": {"start": 3, "end": 6}
    },
    {
      "id": "chapter_1",
      "title": "CHAPTER 1: [Title Based on Content]",
      "keyPoints": ["Main argument 1"],
      "subsections": ["1.1 Subsection A", "1.2 Subsection B", "1.3 Subsection C"],
      "dependencies": ["literature_review"],
      "paragraphRange": {"start": 6, "end": 10}
    }
  ],
  "keyTerms": [{"term": "term", "definition": "meaning"}],
  "globalConstraints": ["Key claims that must remain consistent"],
  "logicalFlow": "How the argument progresses from introduction through chapters to conclusion"
}

MANDATORY SECTIONS (in order):
- abstract
- introduction  
- literature_review
- chapter_1, chapter_2, chapter_3, ... (as many as needed)
- conclusion

CRITICAL REQUIREMENTS FOR paragraphRange:
- start is INCLUSIVE, end is EXCLUSIVE (like Python slicing)
- Sections MUST be contiguous: section 1 ends where section 2 begins
- Cover ALL ${paragraphs.length} paragraphs: first section starts at 0, last section ends at ${paragraphs.length}
- NO GAPS or overlaps between sections

CRITICAL: Each chapter MUST include a "subsections" array with 2-4 subsection titles.

${customInstructions ? `\nADDITIONAL INSTRUCTIONS: ${customInstructions}` : ''}

Return ONLY valid JSON.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }]
  });

  const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
  
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }
    const outline = JSON.parse(jsonMatch[0]) as DocumentOutline;
    console.log(`[Outline-First] Extracted outline with ${outline.sections.length} sections`);
    return outline;
  } catch (e) {
    console.error("[Outline-First] Failed to parse outline:", e);
    // Return a minimal outline that covers all paragraphs with mandatory structure
    const totalParagraphs = paragraphs.length;
    const abstractEnd = Math.ceil(totalParagraphs * 0.02);
    const introEnd = Math.ceil(totalParagraphs * 0.08);
    const litRevEnd = Math.ceil(totalParagraphs * 0.18);
    const conclusionStart = Math.floor(totalParagraphs * 0.92);
    
    return {
      thesis: "Document thesis not extracted",
      sections: [
        { id: "abstract", title: "Abstract", keyPoints: ["Summary of findings"], subsections: [], dependencies: [], paragraphRange: { start: 0, end: abstractEnd } },
        { id: "introduction", title: "Introduction", keyPoints: ["Context and thesis"], subsections: ["Background", "Problem Statement", "Thesis"], dependencies: [], paragraphRange: { start: abstractEnd, end: introEnd } },
        { id: "literature_review", title: "Literature Review", keyPoints: ["Prior work"], subsections: ["Historical Context", "Contemporary Debates"], dependencies: ["introduction"], paragraphRange: { start: introEnd, end: litRevEnd } },
        { id: "chapter_1", title: "CHAPTER 1: Main Argument", keyPoints: ["Core argument"], subsections: ["1.1 Foundation", "1.2 Development", "1.3 Evidence"], dependencies: ["literature_review"], paragraphRange: { start: litRevEnd, end: conclusionStart } },
        { id: "conclusion", title: "Conclusion", keyPoints: ["Summary and implications"], subsections: [], dependencies: ["chapter_1"], paragraphRange: { start: conclusionStart, end: totalParagraphs } }
      ],
      keyTerms: [],
      globalConstraints: [],
      logicalFlow: "Introduction → Literature Review → Main Argument → Conclusion"
    };
  }
}

/**
 * Reconstruct a single section while respecting the global outline
 * Now only passes the RELEVANT PARAGRAPHS to avoid token overflow
 */
async function reconstructSection(
  paragraphs: string[],
  section: OutlineSection,
  outline: DocumentOutline,
  previousSections: { sectionId: string; content: string }[],
  customInstructions?: string,
  aggressiveness: "conservative" | "aggressive" = "aggressive"
): Promise<string> {
  
  // Extract ONLY the paragraphs relevant to this section
  const sectionParagraphs = paragraphs.slice(
    section.paragraphRange.start,
    section.paragraphRange.end
  );
  const sectionText = sectionParagraphs.join('\n\n');
  
  console.log(`[Outline-First] Section ${section.id}: paragraphs ${section.paragraphRange.start}-${section.paragraphRange.end} (${sectionParagraphs.length} paragraphs, ~${sectionText.split(/\s+/).length} words)`);
  
  // Build context from previous sections (abbreviated to save tokens)
  const previousContext = previousSections.length > 0
    ? previousSections.slice(-3).map(s => `[${s.sectionId}]: ${s.content.substring(0, 300)}...`).join('\n\n')
    : "No previous sections yet.";

  // Build subsection instruction
  const subsectionInstruction = section.subsections && section.subsections.length > 0
    ? `\nSUBSECTIONS TO INCLUDE (use these as headings within this section):
${section.subsections.map(s => `- ${s}`).join('\n')}
Each subsection should be clearly marked with its title as a heading.`
    : '';

  const prompt = `You are reconstructing ONE SECTION of a larger FORMAL ACADEMIC DOCUMENT.

DOCUMENT THESIS: ${outline.thesis}

GLOBAL CONSTRAINTS (must remain true throughout):
${outline.globalConstraints.map(c => `- ${c}`).join('\n')}

KEY TERMS TO USE CONSISTENTLY:
${outline.keyTerms.map(t => `- ${t.term}: ${t.definition}`).join('\n')}

LOGICAL FLOW: ${outline.logicalFlow}

FULL OUTLINE:
${outline.sections.map(s => `${s.id}: ${s.title}`).join('\n')}

PREVIOUS SECTIONS (last 3, abbreviated):
${previousContext}

CURRENT SECTION TO RECONSTRUCT: ${section.id} - ${section.title}

KEY POINTS TO COVER:
${section.keyPoints.map(p => `- ${p}`).join('\n')}
${subsectionInstruction}

DEPENDS ON: ${section.dependencies.length > 0 ? section.dependencies.join(', ') : 'None'}

ORIGINAL TEXT FOR THIS SECTION ONLY:
${sectionText}

RECONSTRUCTION RULES${aggressiveness === 'aggressive' ? ' (AGGRESSIVE MODE)' : ' (CONSERVATIVE MODE)'}:
${aggressiveness === 'aggressive' ? `
- Fix ALL problems: vague claims, weak arguments, false claims, implicit reasoning
- Make every claim specific and defensible
- Add missing evidence and logical steps
- Replace false claims with closest true alternatives
- Maintain the author's voice but strengthen every argument` : `
- Fix ONLY clear problems
- Preserve the author's original intent
- Minimal intervention approach
- Only clarify what is genuinely unclear`}

COHERENCE REQUIREMENTS:
1. Must be consistent with the thesis
2. Must respect all global constraints
3. Must use key terms as defined
4. Must flow logically from previous sections
5. If this section depends on others, reference their conclusions appropriately

OUTPUT FORMAT:
1. DO NOT include the section title at the start - it will be added by the system
2. If subsections are specified above, include them as clear headings within the section content
3. Write in formal academic prose - NO bullet points, NO markdown formatting
4. Each subsection should flow naturally into the next

Write the reconstructed section content ONLY. Do NOT start with the section title.
${section.id === 'abstract' ? 'Aim for 200-400 words.' : section.id === 'conclusion' ? 'Aim for 400-800 words.' : 'Aim for 800-1500 words with clear subsections.'}

${customInstructions ? `\nADDITIONAL INSTRUCTIONS: ${customInstructions}` : ''}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }]
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
}

/**
 * Main function: Outline-First Reconstruction
 * 
 * 1. Extract strict outline from entire document
 * 2. Reconstruct each section respecting the outline
 * 3. Assemble into final coherent document
 */
export async function outlineFirstReconstruct(
  text: string,
  customInstructions?: string,
  aggressiveness: "conservative" | "aggressive" = "aggressive",
  onProgress?: (stage: string, current: number, total: number) => void
): Promise<ReconstructionResult> {
  const startTime = Date.now();
  const inputWords = text.trim().split(/\s+/).length;
  
  console.log(`[Outline-First] Starting reconstruction of ${inputWords} word document`);
  
  // Split text into paragraphs for section mapping
  const paragraphs = splitIntoParagraphs(text);
  console.log(`[Outline-First] Document split into ${paragraphs.length} paragraphs`);
  
  // PHASE 1: Extract Strict Outline with paragraph mappings
  onProgress?.("Extracting document structure...", 0, 1);
  const outline = await extractStrictOutline(text, paragraphs, customInstructions);
  
  // Validate and repair paragraph ranges with rigorous checks
  console.log("[Outline-First] Validating paragraph ranges...");
  
  /**
   * Validates that paragraph ranges meet ALL requirements:
   * 1. First section starts at paragraph 0
   * 2. Last section ends at paragraphs.length
   * 3. Sections are contiguous (no gaps or overlaps)
   * 4. All sections have non-empty ranges (start < end)
   */
  function validateAndRepairRanges(sections: OutlineSection[], totalParagraphs: number): boolean {
    if (sections.length === 0) {
      console.warn("[Outline-First] No sections - creating even distribution");
      return false;
    }
    
    let isValid = true;
    
    // Sort by start position first
    sections.sort((a, b) => (a.paragraphRange?.start ?? 0) - (b.paragraphRange?.start ?? 0));
    
    // Check each section
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      
      // Check if paragraphRange exists
      if (!section.paragraphRange || section.paragraphRange.start === undefined || section.paragraphRange.end === undefined) {
        console.warn(`[Outline-First] Section ${section.id} missing valid paragraphRange`);
        isValid = false;
        continue;
      }
      
      // Clamp and floor values
      section.paragraphRange.start = Math.max(0, Math.floor(section.paragraphRange.start));
      section.paragraphRange.end = Math.min(totalParagraphs, Math.floor(section.paragraphRange.end));
      
      // Check for empty section
      if (section.paragraphRange.start >= section.paragraphRange.end) {
        console.warn(`[Outline-First] Section ${section.id} has empty range: ${section.paragraphRange.start} >= ${section.paragraphRange.end}`);
        isValid = false;
      }
    }
    
    // Check first section starts at 0
    if (sections[0].paragraphRange && sections[0].paragraphRange.start !== 0) {
      console.warn(`[Outline-First] First section doesn't start at 0 (starts at ${sections[0].paragraphRange.start})`);
      isValid = false;
    }
    
    // Check last section ends at totalParagraphs
    const lastSection = sections[sections.length - 1];
    if (lastSection.paragraphRange && lastSection.paragraphRange.end !== totalParagraphs) {
      console.warn(`[Outline-First] Last section doesn't end at ${totalParagraphs} (ends at ${lastSection.paragraphRange.end})`);
      isValid = false;
    }
    
    // Check contiguity
    for (let i = 1; i < sections.length; i++) {
      const prev = sections[i - 1];
      const curr = sections[i];
      if (prev.paragraphRange && curr.paragraphRange && prev.paragraphRange.end !== curr.paragraphRange.start) {
        console.warn(`[Outline-First] Gap/overlap between ${prev.id} (ends ${prev.paragraphRange.end}) and ${curr.id} (starts ${curr.paragraphRange.start})`);
        isValid = false;
      }
    }
    
    return isValid;
  }
  
  function createEvenDistribution(sections: OutlineSection[], totalParagraphs: number): void {
    console.log("[Outline-First] Creating even paragraph distribution...");
    const sectionCount = sections.length;
    const paragraphsPerSection = Math.ceil(totalParagraphs / sectionCount);
    
    for (let i = 0; i < sections.length; i++) {
      const start = i * paragraphsPerSection;
      const end = Math.min((i + 1) * paragraphsPerSection, totalParagraphs);
      sections[i].paragraphRange = { start, end };
      console.log(`[Outline-First] ${sections[i].id}: paragraphs ${start}-${end}`);
    }
    
    // Ensure last section ends exactly at totalParagraphs
    if (sections.length > 0) {
      sections[sections.length - 1].paragraphRange.end = totalParagraphs;
    }
  }
  
  function repairRanges(sections: OutlineSection[], totalParagraphs: number): void {
    console.log("[Outline-First] Repairing paragraph ranges...");
    
    // Sort by start position
    sections.sort((a, b) => (a.paragraphRange?.start ?? 0) - (b.paragraphRange?.start ?? 0));
    
    // Force first section to start at 0
    if (sections[0].paragraphRange) {
      sections[0].paragraphRange.start = 0;
    }
    
    // Fix gaps and overlaps
    for (let i = 1; i < sections.length; i++) {
      const prev = sections[i - 1];
      const curr = sections[i];
      if (prev.paragraphRange && curr.paragraphRange) {
        curr.paragraphRange.start = prev.paragraphRange.end;
      }
    }
    
    // Force last section to end at totalParagraphs
    const lastSection = sections[sections.length - 1];
    if (lastSection.paragraphRange) {
      lastSection.paragraphRange.end = totalParagraphs;
    }
    
    // Handle any sections that became empty after repair
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (section.paragraphRange && section.paragraphRange.start >= section.paragraphRange.end) {
        // Give this section at least 1 paragraph by taking from next section
        if (i < sections.length - 1 && sections[i + 1].paragraphRange) {
          section.paragraphRange.end = section.paragraphRange.start + 1;
          sections[i + 1].paragraphRange.start = section.paragraphRange.end;
        }
      }
    }
  }
  
  // First pass: validate
  const isValid = validateAndRepairRanges(outline.sections, paragraphs.length);
  
  if (!isValid) {
    // Check if we can repair or need full redistribution
    const hasAnyValidRanges = outline.sections.some(s => 
      s.paragraphRange && s.paragraphRange.start !== undefined && s.paragraphRange.end !== undefined
    );
    
    if (hasAnyValidRanges) {
      // Try to repair existing ranges
      repairRanges(outline.sections, paragraphs.length);
    } else {
      // No valid ranges at all - create even distribution
      createEvenDistribution(outline.sections, paragraphs.length);
    }
    
    // Verify repair worked
    const stillValid = validateAndRepairRanges(outline.sections, paragraphs.length);
    if (!stillValid) {
      console.warn("[Outline-First] Repair failed - forcing even distribution");
      createEvenDistribution(outline.sections, paragraphs.length);
    }
  }
  
  // Log final ranges
  console.log("[Outline-First] Final paragraph ranges:");
  outline.sections.forEach(s => {
    console.log(`  ${s.id}: ${s.paragraphRange.start}-${s.paragraphRange.end} (${s.paragraphRange.end - s.paragraphRange.start} paragraphs)`);
  });
  
  console.log(`[Outline-First] Outline extracted: ${outline.sections.length} sections, ${outline.keyTerms.length} key terms`);
  
  // PHASE 2: Reconstruct Each Section using ONLY its relevant paragraphs
  const sectionOutputs: { sectionId: string; content: string }[] = [];
  const totalSections = outline.sections.length;
  
  for (let i = 0; i < outline.sections.length; i++) {
    const section = outline.sections[i];
    onProgress?.(`Reconstructing section ${i + 1}/${totalSections}: ${section.title}`, i, totalSections);
    
    console.log(`[Outline-First] Reconstructing section ${i + 1}/${totalSections}: ${section.title}`);
    
    const sectionContent = await reconstructSection(
      paragraphs,  // Now passing paragraphs instead of full text
      section,
      outline,
      sectionOutputs,
      customInstructions,
      aggressiveness
    );
    
    sectionOutputs.push({
      sectionId: section.id,
      content: sectionContent
    });
    
    // Rate limiting to avoid API throttling
    if (i < outline.sections.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // PHASE 3: Assemble Final Document
  onProgress?.("Assembling final document...", totalSections, totalSections);
  
  // Create the final assembled document - CLEAN OUTPUT, no decorative separators
  // LLM is instructed NOT to include titles, so we always prepend them here
  const assembledSections = outline.sections.map((section, idx) => {
    const output = sectionOutputs.find(s => s.sectionId === section.id);
    const sectionContent = output?.content || '';
    // Only include non-empty sections
    if (!sectionContent.trim()) return '';
    
    // Always prepend the section title
    return `${section.title}\n\n${sectionContent.trim()}`;
  }).filter(s => s.trim().length > 0);
  
  // Join with clean paragraph breaks only - no decorative separators
  const reconstructedText = assembledSections.join('\n\n');
  const outputWords = reconstructedText.trim().split(/\s+/).length;
  const timeMs = Date.now() - startTime;
  
  console.log(`[Outline-First] Complete: ${inputWords} → ${outputWords} words in ${timeMs}ms`);
  
  return {
    reconstructedText,
    outline,
    sectionOutputs,
    processingStats: {
      inputWords,
      outputWords,
      sectionsProcessed: sectionOutputs.length,
      timeMs
    }
  };
}

/**
 * Check if document should use outline-first reconstruction
 * 
 * Outline-first works best for medium-length documents (1200-25000 words).
 * For very long documents (>25000 words), the cross-chunk approach is more reliable
 * as it doesn't require fitting the entire document in context for outline extraction.
 */
export function shouldUseOutlineFirst(wordCount: number): boolean {
  // Use outline-first for documents 1200-25000 words
  // Below 1200: simple single-pass reconstruction works fine
  // Above 25000: document too long for reliable outline extraction, use cross-chunk instead
  return wordCount >= 1200 && wordCount <= 25000;
}

/**
 * Get the recommended reconstruction method for a given word count
 */
export function getRecommendedMethod(wordCount: number): "simple" | "outline-first" | "cross-chunk" {
  if (wordCount < 1200) return "simple";
  if (wordCount <= 25000) return "outline-first";
  return "cross-chunk";
}
