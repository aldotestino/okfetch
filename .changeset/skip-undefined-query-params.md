---
"@okfetch/fetch": patch
"@okfetch/api": patch
---

Skip explicit-`undefined` query/params/body values at serialization time instead of stringifying them into the literal string "undefined".
