export default class OpenAIMock {
  chat = { completions: { create: async () => (async function* () {
    yield { choices: [{ delta: { content: Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ") + " FULL_ANSWER_TAIL" } }] };
  })() } };
}
