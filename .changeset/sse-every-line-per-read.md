---
"@okfetch/fetch": patch
---

Emit every SSE message when one network read carries several. The stream parser returned after enqueuing the first `data:` line of a read, and the remaining complete lines of that read were already out of the buffer, so they were dropped.
