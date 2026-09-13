---
name: Function workspace retention
description: The product rule for preserving papers and form state when users transfer work between NEUROTEXT functions.
---

Every NEUROTEXT function owns an independent persistent workspace. Switching functions or sending a generated paper to another function must copy the paper to the destination without clearing or moving the source function’s input, instructions, settings, outline, or result.

**Why:** Users need to return to the originating function and compare its paper against objections, rewrites, or other downstream results. A blank originating workspace looks like data loss and destroys confidence.

**How to apply:** Treat cross-function transfer as copy, never move. Preserve each function through navigation and reload. Any future state reset must be explicit and scoped to the action the user selected.