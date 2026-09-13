---
name: Preview stream transport
description: The transport format required for visible token delivery through the Replit Preview proxy.
---

Use newline-delimited JSON over a `text/plain` response for browser-visible document streaming. Send one JSON event per line and parse incrementally in the client.

**Why:** SSE framing, forced flushes, anti-buffer padding, and anti-buffering headers still allowed an entire long request to remain invisible in the Preview browser until server-side work finished.

**How to apply:** Preserve native provider token callbacks, write each event as its own newline-delimited JSON record, flush after each record, and keep the client parser compatible with incremental lines.