---
name: Neon table namespacing
description: Avoid collisions with pre-existing customer database tables when adding NEUROTEXT persistence.
---

New persistence for NEUROTEXT must use a product-specific table prefix rather than generic names such as `coherence_jobs`.

**Why:** The connected Neon database can already contain unrelated tables with the same generic names but incompatible schemas; reusing them risks a runtime failure or an unintended change to existing application data.

**How to apply:** When adding NEUROTEXT-owned tables, use the `neurotext_` prefix and reference only those tables from the new service.