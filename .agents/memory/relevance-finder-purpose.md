---
name: Relevance Finder purpose
description: Function 14 explains known relevance and optionally incorporates it into the user's draft.
---
Relevance Finder takes the user's unfinished draft and another author's text believed to be relevant. Optional custom instructions may specify what kind of relevance to investigate. Its first action explains the specific connections, supported by actual quotations from the supplied source.

Only a separate, optional action rewrites the draft using those findings. Preserve the original draft and report separately; preserve the user's argument and intellectual direction, and distinguish imported contributions through attribution and accurate quotations.

The rewrite has its own optional custom instructions, separate from the report's relevance instructions. Changing rewrite instructions must not require regenerating the report.

**Why:** Dr. Kuczynski requested that users be able to insert custom instructions concerning the rewrite.

**How to apply:** Save rewrite directions with private work and apply them only during rewriting. Keep the report, original documents and existing rewritten draft available when the user edits these directions.

**Why:** Dr. Kuczynski requested these two stages, reviewed this interpretation and explicitly authorized creating Function 14. It differs from Function 12, which first asks whether candidate material is relevant; do not replace or merge that function.

**How to apply:** Keep both document roles separate from optional instructions. Long treatises must be processed in sections with evidence from later sections retained, not silently reduced to the beginning of a model context window. Do not force a connection or invent quotations, attribution or page numbers.

Deliver the generated working rewrite without blocking it on quotation or attribution certification. The author can review it.

**Why:** Dr. Kuczynski explicitly rejected withholding useful output because of “fussy protocols about verification of quotes.” He said not to let the app totally fabricate, but not to hold it to absurd standards or waste the user's time.

**How to apply:** Ground generation in the supplied source and report, instruct the model not to invent quotations or bibliographic facts, prefer attributed paraphrase when wording is uncertain, and show a review notice alongside the delivered draft. Do not restore strict quotation-matching gates, metadata requirements, or quality-retry loops before displaying prose. Preserve actual provider-error handling, authentication/payment enforcement and the original draft/report.

Do not reject otherwise verified relevance findings because a model supplied an unverified document title or source label. Use the neutral input identifier “Box B” instead; continue to reject unsupported quotations.

**Why:** Uploaded or pasted text need not contain its filename or title. Treating model-generated metadata as a mandatory exact textual match blocked a user's entire report.

**How to apply:** Keep bibliographic metadata separate from evidence validation. Never display an invented title, and do not require another model call just to repair a source label.

Quotation-validation failures must trigger bounded automatic correction, retaining verified connections rather than discarding the entire report.

**Why:** After the source-label fix, the user encountered a second blocked report when the provider altered quotation wording. A single bad point must not erase valid findings.

**How to apply:** Accept harmless typographic substitutions only when the quotation can be recovered from the actual document, displaying its original wording. Never use semantic/fuzzy matches to certify a quotation. Omit unsupported points with an explicit notice if correction fails but verified findings remain; do not misreport failed validation as absence of relevance.

Use the user's latest saved draft and report for realistic rewrite checks, not just the older development-owner workspace. Local fixes do not automatically update Coolify.

**Why:** A successful run against an older development draft did not establish that the newer signed-in draft worked, and screenshots from the live site did not appear in development logs.

**How to apply:** Keep test reads read-only and do not modify saved originals. Distinguish development verification from a live deployment update. A successful generated draft is not independently certified scholarship.
