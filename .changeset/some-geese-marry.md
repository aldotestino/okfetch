---
"@okfetch/api": patch
"@okfetch/fetch": patch
"@okfetch/otel": minor
---

Add `@okfetch/otel`, an OpenTelemetry HTTP semantic-conventions tracing plugin with explicit header and body-size capture, configurable credential redaction, retry events, error details, and trace-context propagation. Export plugin context types from `@okfetch/fetch`, preserve underlying error messages in `FetchError`, and invoke `onFail` for hook and response body-read failures. Route `@okfetch/api` input validation failures through plugin failure hooks so logging and tracing plugins can observe them without sending a network request.
