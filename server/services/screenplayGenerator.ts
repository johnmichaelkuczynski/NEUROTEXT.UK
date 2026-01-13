import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

const DEFAULT_TARGET_WORDS = 20000;
const WORDS_PER_CHUNK = 600; // Process in 600-word target chunks

export interface ScreenplayResult {
  screenplay: string;
  wordCount: number;
  structure: {
    actOneWords: number;
    actTwoWords: number;
    actThreeWords: number;
  };
  processingTimeMs: number;
}

interface ScreenplayOutline {
  logline: string;
  genre: string;
  tone: string;
  setting: string;
  timeframe: string;
  protagonistName: string;
  protagonistDescription: string;
  protagonistGoal: string;
  antagonistName: string;
  antagonistDescription: string;
  centralConflict: string;
  thematicCore: string;
  actOneBeats: string[];
  actTwoBeats: string[];
  actThreeBeats: string[];
  incitingIncident: string;
  midpointReversal: string;
  allIsLostMoment: string;
  climax: string;
  resolution: string;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

async function extractScreenplayOutline(
  sourceText: string,
  targetWordCount: number,
  customInstructions?: string
): Promise<ScreenplayOutline> {
  console.log(`[Screenplay] Extracting global outline for ${countWords(sourceText)} word source...`);
  
  const prompt = `You are a professional screenplay analyst. Analyze the following source material and extract a complete screenplay outline.

SOURCE MATERIAL:
${sourceText.substring(0, 30000)}

TARGET LENGTH: ${targetWordCount} words total screenplay
${customInstructions ? `CUSTOM INSTRUCTIONS FROM USER: ${customInstructions}` : ''}

Extract a detailed screenplay outline as JSON. The structure must follow the three-act format with the beat placements below:
- Act One: ~25% of total (setup, inciting incident by 10%)
- Act Two: ~50% of total (rising action, midpoint reversal at 50%, all-is-lost at 75%)
- Act Three: ~25% of total (climax at ~90%, resolution)

Return ONLY valid JSON:
{
  "logline": "One-sentence summary of the story",
  "genre": "Primary genre (drama, thriller, comedy, etc.)",
  "tone": "Overall tone (dark, hopeful, comedic, etc.)",
  "setting": "Primary location/world",
  "timeframe": "When the story takes place",
  "protagonistName": "Main character name",
  "protagonistDescription": "Physical description for first appearance (filmable only)",
  "protagonistGoal": "What they want",
  "antagonistName": "Antagonist or opposing force",
  "antagonistDescription": "Physical description for first appearance (filmable only)",
  "centralConflict": "The core dramatic question",
  "thematicCore": "The central theme",
  "actOneBeats": ["Opening image", "Setup beat", "Inciting incident", "Act one turning point"],
  "actTwoBeats": ["First obstacle", "Rising action", "Midpoint reversal", "Complications", "All is lost moment", "Dark night of soul", "Act two turning point"],
  "actThreeBeats": ["Final push", "Climax", "Resolution", "Closing image"],
  "incitingIncident": "Specific description of the inciting incident",
  "midpointReversal": "Specific description of the midpoint reversal",
  "allIsLostMoment": "Specific description of the all-is-lost moment",
  "climax": "Specific description of the climax",
  "resolution": "Specific description of the resolution"
}`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    temperature: 0.4,
    messages: [{ role: "user", content: prompt }]
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
  
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in outline response");
    return JSON.parse(jsonMatch[0]) as ScreenplayOutline;
  } catch (e) {
    console.error("[Screenplay] Outline parsing failed:", e);
    throw new Error("Failed to parse screenplay outline");
  }
}

async function generateScreenplayChunk(
  outline: ScreenplayOutline,
  chunkIndex: number,
  totalChunks: number,
  targetChunkWords: number,
  previousContent: string,
  customInstructions?: string
): Promise<string> {
  const actPosition = chunkIndex / totalChunks;
  let currentAct: string;
  let actBeat: string;
  let structuralNote: string;
  
  if (actPosition < 0.25) {
    currentAct = "ACT ONE";
    const beatIndex = Math.floor((actPosition / 0.25) * outline.actOneBeats.length);
    actBeat = outline.actOneBeats[Math.min(beatIndex, outline.actOneBeats.length - 1)] || "Setup";
    
    if (actPosition < 0.10) {
      structuralNote = "We are before the inciting incident. Focus on world-building, character introduction, and establishing the status quo.";
    } else {
      structuralNote = `Inciting incident should occur now: ${outline.incitingIncident}`;
    }
  } else if (actPosition < 0.75) {
    currentAct = "ACT TWO";
    const act2Progress = (actPosition - 0.25) / 0.50;
    const beatIndex = Math.floor(act2Progress * outline.actTwoBeats.length);
    actBeat = outline.actTwoBeats[Math.min(beatIndex, outline.actTwoBeats.length - 1)] || "Rising action";
    
    if (actPosition >= 0.48 && actPosition <= 0.52) {
      structuralNote = `MIDPOINT REVERSAL: ${outline.midpointReversal}`;
    } else if (actPosition >= 0.73 && actPosition <= 0.77) {
      structuralNote = `ALL IS LOST MOMENT: ${outline.allIsLostMoment}`;
    } else {
      structuralNote = "Continue building tension and complications.";
    }
  } else {
    currentAct = "ACT THREE";
    const act3Progress = (actPosition - 0.75) / 0.25;
    const beatIndex = Math.floor(act3Progress * outline.actThreeBeats.length);
    actBeat = outline.actThreeBeats[Math.min(beatIndex, outline.actThreeBeats.length - 1)] || "Final push";
    
    if (actPosition >= 0.88 && actPosition <= 0.92) {
      structuralNote = `CLIMAX: ${outline.climax}`;
    } else if (actPosition >= 0.95) {
      structuralNote = `RESOLUTION: ${outline.resolution}. Include FADE OUT at the end.`;
    } else {
      structuralNote = "Build toward the climax.";
    }
  }

  const isFirstChunk = chunkIndex === 0;
  const isLastChunk = chunkIndex === totalChunks - 1;
  
  const previousContentSummary = previousContent 
    ? `\n\nPREVIOUS SCREENPLAY CONTENT (for continuity - DO NOT repeat this, continue from where it left off):\n${previousContent.slice(-3000)}`
    : '';

  const prompt = `You are writing a professional screenplay. This is chunk ${chunkIndex + 1} of ${totalChunks}.

SCREENPLAY OUTLINE:
- Logline: ${outline.logline}
- Genre: ${outline.genre}
- Tone: ${outline.tone}
- Setting: ${outline.setting}
- Protagonist: ${outline.protagonistName} - ${outline.protagonistDescription}
- Goal: ${outline.protagonistGoal}
- Antagonist: ${outline.antagonistName} - ${outline.antagonistDescription}
- Central Conflict: ${outline.centralConflict}
- Theme: ${outline.thematicCore}

CURRENT POSITION:
- Act: ${currentAct}
- Beat: ${actBeat}
- Structural Note: ${structuralNote}

${customInstructions ? `CUSTOM INSTRUCTIONS: ${customInstructions}` : ''}

TARGET LENGTH: Approximately ${targetChunkWords} words for this chunk.
${previousContentSummary}

SCREENPLAY FORMAT REQUIREMENTS:
${isFirstChunk ? '- Start with FADE IN:' : ''}
- Scene headings: INT. or EXT. followed by LOCATION - DAY or NIGHT
- Action lines in present tense describing ONLY what is visible or audible
- Character names in CAPITALS on first appearance with brief physical description
- Dialogue beneath character names
- Parentheticals used sparingly for essential delivery instructions
- Transitions (CUT TO:, DISSOLVE TO:) used where appropriate
${isLastChunk ? '- End with FADE OUT.' : ''}

CRITICAL RULES:
- Visual storytelling ONLY - no internal thoughts, no unfilmable content
- No camera directions unless absolutely essential
- No prose narration
- Present tense throughout
- Balance dialogue and action (roughly equal)
- Continue seamlessly from previous content - DO NOT restart or repeat scenes

Write the next section of the screenplay now:`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    temperature: 0.7,
    messages: [{ role: "user", content: prompt }]
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
  return responseText.trim();
}

export async function generateScreenplay(
  sourceText: string,
  targetWordCount?: number,
  customInstructions?: string
): Promise<ScreenplayResult> {
  const startTime = Date.now();
  const effectiveTargetWords = targetWordCount || DEFAULT_TARGET_WORDS;
  
  console.log(`[Screenplay] Starting generation - Target: ${effectiveTargetWords} words`);
  console.log(`[Screenplay] Source material: ${countWords(sourceText)} words`);
  
  // Step 1: Extract global outline
  const outline = await extractScreenplayOutline(sourceText, effectiveTargetWords, customInstructions);
  console.log(`[Screenplay] Outline extracted - Genre: ${outline.genre}, Protagonist: ${outline.protagonistName}`);
  
  // Step 2: Calculate chunk distribution
  const totalChunks = Math.ceil(effectiveTargetWords / WORDS_PER_CHUNK);
  const wordsPerChunk = Math.ceil(effectiveTargetWords / totalChunks);
  
  console.log(`[Screenplay] Generating ${totalChunks} chunks at ~${wordsPerChunk} words each`);
  
  // Step 3: Generate screenplay in chunks
  let fullScreenplay = '';
  const chunkOutputs: string[] = [];
  
  for (let i = 0; i < totalChunks; i++) {
    console.log(`[Screenplay] Processing chunk ${i + 1}/${totalChunks}...`);
    
    const chunkOutput = await generateScreenplayChunk(
      outline,
      i,
      totalChunks,
      wordsPerChunk,
      fullScreenplay,
      customInstructions
    );
    
    chunkOutputs.push(chunkOutput);
    fullScreenplay += (fullScreenplay ? '\n\n' : '') + chunkOutput;
    
    console.log(`[Screenplay] Chunk ${i + 1} complete - ${countWords(chunkOutput)} words`);
  }
  
  // Step 4: Calculate structure breakdown
  const totalWords = countWords(fullScreenplay);
  const actOneEnd = Math.floor(totalWords * 0.25);
  const actTwoEnd = Math.floor(totalWords * 0.75);
  
  // Approximate word distribution by position
  const words = fullScreenplay.split(/\s+/);
  const actOneWords = actOneEnd;
  const actTwoWords = actTwoEnd - actOneEnd;
  const actThreeWords = totalWords - actTwoEnd;
  
  const processingTimeMs = Date.now() - startTime;
  
  console.log(`[Screenplay] Generation complete - ${totalWords} words in ${Math.round(processingTimeMs / 1000)}s`);
  
  return {
    screenplay: fullScreenplay,
    wordCount: totalWords,
    structure: {
      actOneWords,
      actTwoWords,
      actThreeWords
    },
    processingTimeMs
  };
}
