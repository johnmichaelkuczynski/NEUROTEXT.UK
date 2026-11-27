---
name: Relevance Finder purpose
description: Function 14 explains known relevance and optionally incorporates it into the user's draft.
---
Relevance Finder takes the user's unfinished draft and another author's text believed to be relevant. Optional custom instructions may specify what kind of relevance to investigate. Its first action explains the specific connections, supported by actual quotations from the supplied source.

Only a separate, optional action rewrites the draft using those findings. Preserve the original draft and report separately; preserve the user's argument and intellectual direction, and distinguish imported contributions through attribution and accurate quotations.

**Why:** Dr. Kuczynski requested these two stages, reviewed this interpretation and explicitly authorized creating Function 14. It differs from Function 12, which first asks whether candidate material is relevant; do not replace or merge that function.

**How to apply:** Keep both document roles separate from optional instructions. Long treatises must be processed in sections with evidence from later sections retained, not silently reduced to the beginning of a model context window. Do not force a connection or invent quotations, attribution or page numbers.

Validate source attribution in the rewrite rather than relying only on a prompt.

**Why:** A live provider check initially produced a fluent rewrite that presented imported claims without attribution despite being told to attribute them. Checking only quotations in the report does not prevent this.

**How to apply:** Require source-derived additions to have explicit in-text attribution and verifiable supporting evidence; verbatim borrowing must be quoted. Reject or correct unsupported additions before displaying a rewritten section.

Do not reject otherwise verified relevance findings because a model supplied an unverified document title or source label. Use the neutral input identifier “Box B” instead; continue to reject unsupported quotations.

**Why:** Uploaded or pasted text need not contain its filename or title. Treating model-generated metadata as a mandatory exact textual match blocked a user's entire report.

**How to apply:** Keep bibliographic metadata separate from evidence validation. Never display an invented title, and do not require another model call just to repair a source label.

Quotation-validation failures must trigger bounded automatic correction, retaining verified connections rather than discarding the entire report.

**Why:** After the source-label fix, the user encountered a second blocked report when the provider altered quotation wording. A single bad point must not erase valid findings.

**How to apply:** Accept harmless typographic substitutions only when the quotation can be recovered from the actual document, displaying its original wording. Never use semantic/fuzzy matches to certify a quotation. Omit unsupported points with an explicit notice if correction fails but verified findings remain; do not misreport failed validation as absence of relevance.
