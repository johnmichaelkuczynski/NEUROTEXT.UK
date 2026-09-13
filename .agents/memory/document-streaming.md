---
name: Document streaming
description: Long-form NEUROTEXT output must arrive as provider tokens, not delayed per completed chunk.
---

For NEUROTEXT document generation, use the LLM providers' native streaming APIs and forward each token over the event stream to the browser.

**Why:** Paragraph-level chunking alone does not improve first-visible-output time when a document fits in one chunk; users still wait for the complete model response.

**How to apply:** Every document function must emit events immediately, append them in the result view, disable proxy buffering, and retain full accumulated text only for persistence or final processing. The first-visible-text deadline is cumulative across empty provider events, and the full fallback chain must fit inside the browser SLA. If a provider emits an oversized delta, normalize it into small paced word groups; one completed block is a streaming failure even when its content is acceptable.

Provider failure must never leave a usable document short. Preserve every partial token, continue the same block with the next configured provider without repeating text, and keep advancing toward the requested target.

**Why:** Returning a partial block after one provider interruption preserved text but still allowed a long paper to terminate thousands of words below its requested length.

**How to apply:** Carry partial text through the full provider chain. Prompt each fallback to continue from the exact final sentence, forward only its new tokens, and return partial output only after every provider has been attempted.

Never restart either the frontend or API workflow while a document stream is active. A frontend restart reloads the browser and aborts its fetch even when the API process remains healthy.

**Why:** Restarting the web workflow aborted two active `/api/functions/stream` requests simultaneously and destroyed the user-visible generation.

**How to apply:** Before any workflow restart, confirm that no generation request is active. If one is active, leave the workflow running and make only hot-reload-safe frontend changes or wait for completion.

For interactive generation, split source material by actual word boundaries—not only paragraph boundaries—and keep generated sections small enough for continuous review.

**Why:** A long pasted document is often one unbroken paragraph; paragraph-only splitting turns it into one huge first request and recreates the blank-screen wait.

**How to apply:** Send a block-start event before each model call, stream the provider’s native tokens, and make the active block number visible in the client.

Long-form expansion must be driven by the requested output length, not by the source document’s length. Stream the visible opening before generating the hidden thesis-preserving blueprint, then continue constrained blocks until the target is reached.

**Why:** Mapping one output block to each source block turns a short source into a short paraphrase, while requesting the visible opening and hidden blueprint in parallel can let provider serialization block all visible prose.

**How to apply:** Give the opening exclusive priority. After visible prose exists, build the blueprint and give each later block the blueprint, original source, target progress, and continuity context; reject invented citations and filler.

Treat long-form coherence as a three-pass constraint system: formal global skeleton, constrained sequential drafting, then a global consistency stitch with minimal local repairs.

**Why:** Continuity context alone does not explicitly prevent commitment violations, terminology drift, redundant development, structural gaps, or broken cross-references.

**How to apply:** The skeleton must define thesis, outline, key terms, commitment ledger, entities, audience, and rigor. Enforce per-block length, then audit and locally repair the assembled draft before completion.

Prospective and retrospective coherence are separate. Keep the source-derived skeleton frozen; use tiered live memory for commitments introduced during very long generation.

**Why:** A skeleton says what the document must become, while a retrospective accumulator records what prior blocks actually committed to. Recent-text context eventually loses older commitments.

**How to apply:** For mega-documents, add archived, recursively compressed tiers behind a feature flag. Never evict REJECTS or unresolved conflict entries, and audit compression drift visibly.

For coherence evaluations whose source cannot fit in one model context, create compact evidence for every source chunk, stream the evidence phase immediately as progress, and recursively reduce that evidence before the final audit.

**Why:** Clipping a long source produces a confident but incomplete score; delaying all output until chunk indexing finishes makes the evaluator appear stalled.

**How to apply:** Never silently slice a source for a final coherence judgment. Surface the providers used in evidence, structure, and audit phases because fallback can differ by phase.