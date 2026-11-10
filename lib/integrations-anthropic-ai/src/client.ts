import Anthropic from "@anthropic-ai/sdk";

// Construct only when selected so missing optional provider keys never prevent startup.
export function getAnthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured. Add your Anthropic API key to the server environment.");
  return new Anthropic({ apiKey, baseURL: "https://api.anthropic.com" });
}
