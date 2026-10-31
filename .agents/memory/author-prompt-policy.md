---
name: Author-supplied prompt policy
description: Preserve the author's exact prompt wording and keep Translator outside that replacement.
---

The author supplied canonical CORE RULES and thirteen function prompts and explicitly required them verbatim: do not paraphrase, shorten, improve, or append application-authored safety, tone, or professionalism instructions. Empty UI placeholders omit their containing line. Return model output unchanged rather than adding headers, disclaimers, summaries, or bibliography repairs. Translator is explicitly excluded.

**Why:** The author requested precise control over the app's writing instructions, not an interface redesign or an additional editorial policy.

**How to apply:** Keep later prompt work faithful to the supplied wording unless the author requests a change. Put the actual optional UI reference material in the user message rather than modifying canonical system text. Do not reconnect these functions to the legacy academic expansion or output-cleanup pipeline.

Revision uses the supplied Document Transformer prompt against the current output, with the user's critique as the transformation instructions, rather than running the original creation/adaptation task again.

**Why:** No separate revision template was supplied, and the existing product requirement is targeted revision of the current output, never de novo regeneration.

**How to apply:** Preserve that revision behavior when changing prompt routing; do not treat a critique as a new topic for a scratch-writing prompt.
