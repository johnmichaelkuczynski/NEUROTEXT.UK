---
name: Author-supplied prompt policy
description: Preserve the author's exact prompt wording and keep Translator outside that replacement.
---

The author supplied canonical CORE RULES and thirteen function prompts and explicitly required them verbatim, except that they subsequently demanded a substantive correction to the coherence evaluator. For the other author functions, do not paraphrase, shorten, improve, or append application-authored safety, tone, or professionalism instructions. Empty UI placeholders omit their containing line. Return model output unchanged rather than adding headers, disclaimers, summaries, or bibliography repairs. Translator is explicitly excluded.

**Why:** The author requested precise control over the app's writing instructions, not an interface redesign or an additional editorial policy.

**How to apply:** Keep later prompt work faithful to the supplied wording unless the author requests a change. Put the actual optional UI reference material in the user message rather than modifying canonical system text. Do not reconnect these functions to the legacy academic expansion or output-cleanup pipeline.

Coherence evaluation must judge whether the reasoning holds together, not summarize the thesis or generate a compulsory inventory of defects. Writing instructions to preserve or defend the author's thesis do not apply to evaluation. Distinguish genuine contradictions from differences in scope, acknowledged exceptions, and explicit distinctions; distinguish inferential support from internal consistency.

**Why:** The user explicitly rejected the evaluator's output and clarified that length and verbosity are secondary to actually analyzing coherence.

**How to apply:** Keep coherence evaluation separate from thesis-preserving writing rules. Test against both genuine contradictions and coherent distinctions, not just whether a report is produced.

Revision uses the supplied Document Transformer prompt against the current output, with the user's critique as the transformation instructions, rather than running the original creation/adaptation task again.

**Why:** No separate revision template was supplied, and the existing product requirement is targeted revision of the current output, never de novo regeneration.

**How to apply:** Preserve that revision behavior when changing prompt routing; do not treat a critique as a new topic for a scratch-writing prompt.
