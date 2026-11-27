export default class OpenAIMock {
  chat = { completions: { create: async (options: any) => (async function* () {
    const system = options.messages[0].content as string;
    let content = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ") + " FULL_ANSWER_TAIL";
    if (system.includes("NEUROTEXT's Relevance Finder")) {
      const data = JSON.parse(options.messages[1].content);
      const firstSentence = (text: string) => text.split(/(?<=\.)\s/u)[0].trim();
      content = JSON.stringify({ summary: "The source clarifies the draft's account of knowledge.", points: [{
        connection: "The source distinguishes direct awareness from inferential dependence.",
        draftQuote: firstSentence(data.draft), materialQuote: firstSentence(data.relevantText),
        sourceLabel: "Box B", application: "Incorporate this distinction while preserving the author's central argument.",
      }] });
    } else if (system.startsWith("Rewrite ONLY")) {
      const data = JSON.parse(options.messages[1].content);
      const quote = data.sourceEvidence.split(/(?<=\.)\s/u)[0].trim();
      const passage = 'The supplied source (Box B) clarifies this distinction: “' + quote + '”';
      content = JSON.stringify({ text: data.segmentToRewrite + '\n\n' + passage, sourceUses: [{ passage, sourceQuote: quote, sourceLabel: 'Box B' }] });
    }
    yield { choices: [{ delta: { content } }] };
  })() } };
}
