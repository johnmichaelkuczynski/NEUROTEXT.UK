export type DiagnosticCase = {
  id: string;
  name: string;
  path: string;
  endpoint: "/functions/stream" | "/coherence/stream";
  body: Record<string, unknown>;
  preview?: boolean;
  expect: "story" | "replacement" | "screenplay" | "dialogue" | "coherence" | "coherent" | "nonsense" | "rewrite" | "profile" | "academic" | "translation" | "objections";
};

const source = "The village has twelve families. Their shared well runs dry. Mara proposes collecting rainwater in a common tank. Each family can contribute one hour of work a week. They disagree about who should maintain the tank.";
const argument = "All twelve families need water. A shared tank could collect rainwater. Because each family benefits, each should help maintain it. Shared benefit alone does not guarantee participation; a published rota would make responsibilities explicit.";
const fields = (instructions: string, extra: Record<string, unknown> = {}) => JSON.stringify({ authorPrompt: 1, instructions, ...extra });

export const DIAGNOSTIC_CASES: DiagnosticCase[] = [
  { id: "creator", name: "Write from scratch", path: "/page-2", endpoint: "/functions/stream", expect: "story",
    body: { functionId: "creator", text: "", instructions: fields("", { topic: "Write a complete 90-word fable about an ant and a pear. End the story, not a plan or summary." }) } },
  { id: "manipulator", name: "Document transformer", path: "/page-3", endpoint: "/functions/stream", expect: "replacement",
    body: { functionId: "manipulator", text: "The red balloon rose above the green hill.", instructions: fields("Replace red with blue. Return the entire sentence unchanged otherwise.") } },
  { id: "screenplay", name: "Screenplay from scratch", path: "/page-4", endpoint: "/functions/stream", expect: "screenplay",
    body: { functionId: "screenplay", text: "", instructions: fields("", { topic: "Write a complete 100-word one-scene screenplay. In a village meeting room, Mara and Leo resolve who will maintain their rainwater tank. Include a scene heading and dialogue." }) } },
  { id: "screenplay-adaptation", name: "Text to screenplay", path: "/page-5", endpoint: "/functions/stream", expect: "screenplay",
    body: { functionId: "screenplay", text: source, instructions: fields("Adapt into a complete 120-word one-scene screenplay. End the scene.") } },
  { id: "dialogue", name: "Dialogue from scratch", path: "/page-6", endpoint: "/functions/stream", expect: "dialogue",
    body: { functionId: "dialogue", text: "", instructions: fields("", { topic: "Write a complete 100-word dialogue between Mara and Leo about whether shared benefits imply shared responsibilities. Use speaker names and colons." }) } },
  { id: "dialogue-adaptation", name: "Text to dialogue — no extra instructions", path: "/page-7", endpoint: "/functions/stream", expect: "dialogue",
    body: { functionId: "dialogue", text: source, instructions: fields("") } },
  { id: "coherence", name: "Coherence evaluator — no extra instructions", path: "/page-8", endpoint: "/coherence/stream", expect: "coherence",
    body: { title: "Diagnostics: coherence", text: "Every contract in this collection is signed. Contract A is in this collection. Contract A is not signed. These claims concern the same time and the same sense of signed.", mode: "logical" } },
  { id: "coherence-consistent", name: "Coherence control — valid distinction", path: "/page-8", endpoint: "/coherence/stream", expect: "coherent",
    body: { title: "Diagnostics: coherent control", text: "I judge that the locked door is safe but still feel afraid of it. My emotional response differs from my intellectual judgment; I am describing distinct psychological states, not asserting both danger and no danger.", mode: "logical" } },
  { id: "coherence-nonsense", name: "Coherence control — meaningless inference", path: "/page-8", endpoint: "/coherence/stream", expect: "nonsense",
    body: { title: "Diagnostics: nonsense control", text: "Purple therefore is the square root of justice. It follows that seven is the opposite of because. Hence every language is a sandwich of therefore.", mode: "logical" } },
  { id: "maxintel", name: "Maximum intelligence rewrite", path: "/page-9", endpoint: "/functions/stream", expect: "rewrite",
    body: { functionId: "maxintel", text: argument, instructions: fields("Keep this under 120 words.") } },
  { id: "profile", name: "Cognitive profiling", path: "/page-10", endpoint: "/functions/stream", expect: "profile",
    body: { functionId: "profile", text: argument, instructions: fields("Keep the entire profile under 180 words. Base judgments on the actual reasoning, not agreement with its conclusion.") } },
  ...(["thesis-creator", "thesis-transformer", "dissertation-creator", "dissertation-transformer"] as const).map((id): DiagnosticCase => ({
    id, name: `${id.startsWith("thesis") ? "Master's thesis" : "Dissertation"} ${id.endsWith("creator") ? "from scratch" : "from text"} — bounded sample`,
    path: `/page-${id === "thesis-creator" ? 11 : id === "thesis-transformer" ? 12 : id === "dissertation-creator" ? 13 : 14}`,
    endpoint: "/functions/stream", preview: true, expect: "academic",
    body: { functionId: id, text: id.endsWith("transformer") ? argument : "", targetWords: "180", diagnosticPreview: true,
      instructions: fields("Diagnostic sample only: give a title, a brief abstract and one substantive introductory paragraph, around 180 words. Do not generate full chapters or a complete thesis/dissertation.", { topic: "Shared benefit and responsibility in maintaining a village water supply" }) },
  })),
  { id: "translator", name: "Translator", path: "/page-15", endpoint: "/functions/stream", expect: "translation",
    body: { functionId: "translator", text: "La bibliothèque ouvre à neuf heures. Le livre est sur la table. Merci.", instructions: "TARGET LANGUAGE: English\nTASK: Translate the source text into English. Preserve every sentence. Return only the translation." } },
  { id: "objections", name: "Objections and bullet-proof rewrite (original portal)", path: "/page-1", endpoint: "/functions/stream", expect: "objections",
    body: { functionId: "objections", text: argument, instructions: "Give one serious objection and a complete revised argument addressing it. Keep the entire response under 140 words." } },
];

export function diagnosticChecks(test: DiagnosticCase, output: string): string[] {
  const failures: string[] = [];
  if (!output.trim()) return ["No output was generated."];
  if (test.expect === "replacement" && output.trim() !== "The blue balloon rose above the green hill.") failures.push("The requested exact replacement was not followed.");
  if (test.expect === "screenplay" && !/\b(?:INT\.|EXT\.|INT\/EXT\.)/i.test(output)) failures.push("No standard screenplay scene heading was found.");
  if (test.expect === "dialogue" && (output.match(/(?:^|\n)\s*(?:\*\*)?[\p{L}][\p{L} .'-]{0,45}:\s*/gu) ?? []).length < 2) failures.push("Fewer than two speaker turns were found.");
  if (test.expect === "coherence" && !/contradict|inconsisten|cannot all|cannot both/i.test(output)) failures.push("The report did not identify the planted contradiction.");
  if (["coherence", "coherent", "nonsense"].includes(test.expect) && /\b\d+\s*\/\s*10\b/.test(output)) failures.push("An unsolicited numerical coherence score was returned.");
  if (test.expect === "coherent" && !/\bcoherent\b|no (?:internal )?contradiction|consistent/i.test(output)) failures.push("The report did not recognize the valid distinction.");
  if (test.expect === "nonsense" && !/meaningless|unintelligible|undefined|category|does not follow|no (?:valid|logical)|incoherent|inconsistent|uninterpretable|no determinate|not coherent/i.test(output)) failures.push("The report did not identify the meaningless or invalid reasoning.");
  if (test.expect === "translation" && !/library/i.test(output)) failures.push("The expected English translation of bibliothèque was missing.");
  if (test.expect === "translation" && !/nine|9/.test(output)) failures.push("The opening time was missing from the translation.");
  if (test.expect === "translation" && !/book/i.test(output)) failures.push("The book sentence was omitted.");
  if (test.expect === "profile" && !/reason|cogniti|deduct|infer|argu/i.test(output)) failures.push("No reasoning or cognitive analysis was found.");
  if (test.expect === "academic" && !/abstract/i.test(output)) failures.push("The bounded academic sample has no abstract.");
  if (test.expect === "academic" && output.trim().split(/\s+/).length < 80) failures.push("The academic sample is too short to exercise substantive generation (fewer than 80 words).");
  if (test.expect === "objections" && !/objection|counterarg|however/i.test(output)) failures.push("No objection was found.");
  if (output.trim().split(/\s+/).length < 8) failures.push("The output is unexpectedly short.");
  return failures;
}
