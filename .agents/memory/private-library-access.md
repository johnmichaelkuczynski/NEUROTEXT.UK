---
name: Private library and account access
description: Optional direct Google OAuth, private account memory, and weighted library/reference limits.
---
Users can try generation anonymously without an entry login wall. Anonymous work must not be retained across reloads, except for an explicit payment/login handoff that preserves the current draft. Login is required for private past work and the personal library. Complete-answer access follows the separate paid-answer policy and owner exceptions.

**Why:** Dr. Kuczynski explicitly requested an app with no persistent memory for anonymous users, and private memory and uploaded research texts for signed-in users; he later required payment and Google login for complete answers.

**How to apply:** Use direct Google OAuth and the existing external, non-Replit Neon PostgreSQL database. Enforce server-side ownership on every private read/write; never attach old anonymous work to an account automatically.

Each user may store up to 10,000 TXT-equivalent pages; DOC and PDF consume more allowance. The implemented policy uses 500 words per page, TXT 1×, DOC/DOCX 2×, PDF/images 4×, plus a 50 MiB weighted-byte ceiling. Store extracted texts, not original file archives.

**Why:** The user asked for 10,000 pages of TXT and progressively fewer DOC/PDF pages. Keeping extracted research text in the external database preserves Coolify portability without introducing a Replit storage dependency.

**How to apply:** Keep the quota visible and enforced atomically. Every supporting-material field must offer signed-in users a personal-library picker. Clearly warn about the per-generation reference limit: 20,000 words or 120,000 characters (about 40 pages), not the whole stored library. Never silently truncate.
