---
name: Coolify public domain
description: User-specified public NEUROTEXT domain for the external Coolify deployment.
---
Dr. Kuczynski stated that NEUROTEXT's public URL is https://neurotext.uk and that he hosts it on Coolify.

**Why:** The user supplied this domain when configuring Google OAuth for the live site.

**How to apply:** Use this user-specified origin for Coolify configuration guidance, not a Replit preview or publishing domain. Verify the live deployment's actual configuration before claiming OAuth works; do not infer credentials or current runtime values from this note.

Google sign-in on the Coolify deployment was confirmed working by Dr. Kuczynski after the canonical-origin correction and proxy/session hardening.

**Why:** The failed live flow sent users from neurotext.uk to a callback on neurotext.xyz, which could not receive the host-only login session cookie.

**How to apply:** Keep the runtime PUBLIC_BASE_URL aligned with the canonical sign-in domain and Google's registered callback. This confirmation does not establish future runtime values.
