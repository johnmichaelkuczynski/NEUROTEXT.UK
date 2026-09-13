---
name: OpenAPI and Zod compatibility
description: Compatibility constraint for generated schemas in this workspace
---

Use numeric OpenAPI fields rather than integer fields when generating Zod schemas in this workspace.

**Why:** The current generated client stack resolves Zod through a version that does not expose `z.int()`, so integer schemas make code generation succeed but fail the workspace typecheck.

**How to apply:** When adding API contracts, prefer `type: number` for count, progress, and score fields unless the generator/runtime versions are upgraded together.