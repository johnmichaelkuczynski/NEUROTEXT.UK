---
name: Model naming policy
description: User-facing model choices use ZHI aliases rather than vendor model names.
---

Show the four requested model choices as ZHI 1, ZHI 2, ZHI 3, and ZHI 4, in the author's specified order. Do not display their actual vendor/model names in the dropdown or generated-request provider metadata.

**Why:** The author explicitly requested these respective aliases rather than the actual model names.

**How to apply:** Preserve the exact four-choice mapping in the routing configuration. A selected alias must run its corresponding model; do not silently substitute another model while retaining the alias.
