---
name: Interface reset behavior
description: Clearing must keep the user at the same function without flashing an obsolete landing page.
---

A page-level Clear must reset the current function and reload that same page, not redirect to a menu. The user must not see an obsolete landing page flash before the function appears.

**Why:** The user repeatedly reported that Clear appeared to navigate to a strange menu before returning to the cleared function.

**How to apply:** Preserve the current route and return the viewport to the function. Any non-JavaScript fallback content belongs inside noscript so it cannot paint during ordinary JavaScript startup.
