---
name: Development and production owner access
description: Owner exceptions to login and payment requirements.
---
The development workspace must always provide full owner access without requiring Google sign-in or payment. The explicitly designated owner account must also always receive full access in production without paying.

Google login and Stripe installation or later billing changes must never remove these owner exceptions. In deployment, verify the designated Google identity; do not require that owner to subscribe or pay, including when billing is absent, unpaid, expired or cancelled.

**Why:** Dr. Kuczynski expressly instructed that he must never be logged out or denied access in development, asked to save that rule, and separately designated his production Google account for full access. He reiterated that this must remain true after Google login and Stripe are installed.

**How to apply:** Development access must be controlled by the server's development runtime, not a caller-provided hostname, header or query parameter. Never write an automatically privileged development identity into a session that could be copied to production. Production owner access must follow a verified Google identity, not a typed email. The owner identity is app configuration; do not record personal account details in project memory.
