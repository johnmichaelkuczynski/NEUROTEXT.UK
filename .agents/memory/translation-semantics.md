---
name: Translation semantics
description: Keep translation separate from academic generation and interpret relative shortening without compounding revisions.
---

Translation must not inherit academic word-count expansion, scholarly tone, or automatic bibliography insertion. Source numbers are content, not writing-length requests.

**Why:** A translator must preserve supplied material and follow literal, literary, or shortening preferences rather than turn the text into an academic document.

**How to apply:** Keep translation-specific processing distinct from academic generation defaults, including when sharing streaming infrastructure.

Treat an explicit relative shortening request as measurable where the source language supports whitespace word counts. Do not blindly impose those budgets on predominantly unspaced scripts. Ordinary critiques should retain the current translation's length rather than reapply the original shortening.

**Why:** A live “cut length in half” check initially retained about 65% of the source with qualitative instructions alone. Reusing the original reduction on every revision would also progressively shrink a translation even when the user only requested a style change.

**How to apply:** Distinguish original preferences from the latest critique, check explicit shortening against an appropriate measure, and avoid silent completion when a measured target is missed.

For translations, prefer an explicit incomplete-output error with preserved text over an unverified automatic continuation after an output-limit cutoff.

**Why:** A partial multilingual translation does not identify the exact remaining source span. Guessing that boundary can omit or duplicate material, even when a continuation reads fluently. This is intentionally different from academic expansion recovery.

**How to apply:** Stop before accepting a truncated part or retrying its length requirement. Resume automatically only when a reliable source-to-output boundary can be established; otherwise retain all streamed text and clearly report incompleteness.
