---
name: Post-merge database setup
description: Timing and non-interactive requirements for database reconciliation after task merges.
---

Post-merge database reconciliation must use the non-interactive forced schema push and allow substantially more than 20 seconds.

**Why:** A valid schema pull and push takes about 29 seconds in this environment; the former 20-second limit killed it while it was still pulling the schema.

**How to apply:** Keep the post-merge command non-interactive and retain a timeout with enough buffer for dependency installation plus database introspection. Treat the PostgreSQL SSL compatibility message as a warning, not a failed push.