---
"@okfetch/fetch": patch
---

Invoke `onFail` hooks when an `onRequest` or `onResponse` hook throws and when the response body cannot be read, so side-effect plugins observe every failure after the request context is built.
