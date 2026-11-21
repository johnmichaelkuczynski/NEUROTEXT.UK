---
name: Portable Coolify billing
description: Direct Stripe SDK and standard environment variables, not Replit-managed billing credentials.
---
Payment processing must work on the external Coolify deployment using the standard Stripe SDK, explicit environment variables and the existing external PostgreSQL database.

**Why:** The user moved NEUROTEXT to Coolify and expressly required replacing Replit-only integrations with portable provider credentials. A Replit-only billing proxy or credential-discovery dependency would break that deployment.

**How to apply:** Keep Stripe initialization lazy so missing billing keys do not crash startup. Authorize complete output on the server using verified Google identity and verified payment state, with the owner exceptions. Do not infer payment from browser return URLs or create live charges while testing without permission.
