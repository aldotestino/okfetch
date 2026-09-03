# @okfetch/otel

`@okfetch/otel` is an [OpenTelemetry](https://opentelemetry.io/) tracing plugin for okfetch request lifecycles.

It gives you a ready-made `OkfetchPlugin` that records **one `CLIENT` span per request**, covering every retry attempt, with:

- the request method, URL, path, and query string
- explicitly selected request and response headers, with sensitive values redacted
- the response status code
- optional request and response body sizes when they can be observed accurately
- a `traceparent` header on the outgoing request so downstream services join the trace

Request and response bodies are never recorded.

## Installation

```bash
bun add @okfetch/otel @okfetch/fetch @opentelemetry/api
```

```bash
npm install @okfetch/otel @okfetch/fetch @opentelemetry/api
```

You also need an OpenTelemetry SDK registered as the global tracer provider (for example `@opentelemetry/sdk-node`). Without one, the plugin is a no-op.

## Usage

```ts
import { okfetch } from "@okfetch/fetch";
import { otel } from "@okfetch/otel";

const result = await okfetch("https://api.example.com/todos/:id", {
  params: { id: 1 },
  plugins: [otel()],
  query: { include: "owner" },
});
```

Put `otel()` after plugins that add headers if you want those headers captured on the span. Header capture is opt-in, as required by the OpenTelemetry security guidance.

## API

`otel(options?)`

Options:

- `tracer?: Tracer` - tracer used to start spans. Defaults to `trace.getTracer("@okfetch/otel")` from the global provider.
- `captureRequestHeaders?: boolean | readonly string[]` - request header names to record as `http.request.header.<name>`. Defaults to none. Pass `true` to explicitly capture every request header.
- `captureResponseHeaders?: boolean | readonly string[]` - response header names to record as `http.response.header.<name>`. Defaults to none. Pass `true` to explicitly capture every response header.
- `captureBodySizes?: boolean` - record payload body sizes when Fetch exposes enough information to do so accurately. Defaults to `false`.
- `knownMethods?: readonly string[]` - case-sensitive methods known to the instrumentation. Replaces `DEFAULT_KNOWN_HTTP_METHODS` entirely.
- `propagateTraceContext?: boolean` - inject W3C `traceparent` / `tracestate` headers into the request. Defaults to `true`.
- `redact?: { headers?, queryParams?, values? }` - what to redact. `headers` and `queryParams` match names; `values` matches header and query values regardless of name. Each entry is either an array that **replaces** the defaults, or a function that **receives the defaults** and returns the list to use.

```ts
otel({
  captureRequestHeaders: ["content-type", "x-tenant"],
  captureResponseHeaders: ["content-type", "x-request-id"],
  redact: {
    // extend the defaults
    headers: (defaults) => [...defaults, "x-tenant", /^x-internal-/i],
    // replace the defaults entirely
    queryParams: ["customer_id"],
    // also redact any value that looks like an internal ticket id
    values: (defaults) => [...defaults, /^TKT-/],
  },
});
```

Exports:

- `DEFAULT_REDACTED_HEADERS` - `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `api-key`, `x-amz-security-token`, `x-amz-credential`, `x-amz-signature`, plus `DEFAULT_REDACTED_NAME_PATTERN`
- `DEFAULT_KNOWN_HTTP_METHODS` - the RFC 9110 methods plus `PATCH` and `QUERY`
- `DEFAULT_REDACTED_QUERY_PARAMS` - common credential parameter names such as `token`, `access_token`, `api_key`, `password`, `secret`, `signature`, the OAuth grant parameters `code`, `code_verifier`, `client_assertion`, `assertion`, the AWS SigV4 presigned-URL fields `X-Amz-Credential`, `X-Amz-Security-Token`, `X-Amz-Signature`, plus `DEFAULT_REDACTED_NAME_PATTERN`
- `DEFAULT_REDACTED_NAME_PATTERN` - a pattern included in both default lists; any name containing `auth`, `bearer`, `cred`, `jwt`, `otp`, `passw`, `private`, `secret`, `session`, `sig`, `token`, or `api-key` is redacted even when not listed explicitly. Replacing a list with an array drops it, so include it yourself if you still want it.
- `DEFAULT_REDACTED_VALUE_PATTERNS` - patterns applied to every header and query value whatever its name: JWTs (`eyJ...` with three segments) and HTTP authentication credentials (`Bearer`, `Basic`, `Digest`, `Negotiate`, `Token`, `OAuth`, `AWS4-HMAC-SHA256` prefixes)
- `RedactionMatcher`, `RedactionList`, `RedactionOption`, `ValuePatternList`, `ValuePatternOption` - the types behind the `redact` option
- `HeaderCaptureOption` - the type accepted by the request and response header capture options
- `REDACTED_VALUE` - the `REDACTED` placeholder written in place of redacted values

Name matching is case-insensitive for both headers and query parameters. Redaction errs on the side of hiding too much: a name such as `X-Session-Id` is redacted because it matches the default pattern, and a JWT sent under a harmless-looking name is redacted because of its value.

## What It Records

Span name: `{method}`, or `{method} {path template}` when the request uses `params` (for example `GET /todos/:id`).

Attributes follow the OpenTelemetry HTTP semantic conventions where one exists:

| Attribute                      | Value                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `http.request.method`          | Known request method, or `_OTHER`                                            |
| `http.request.method_original` | Original method when `http.request.method` is `_OTHER`                       |
| `http.request.body.size`       | Request payload bytes, when enabled and accurately observable                |
| `http.request.header.<name>`   | Explicitly selected request header values, with sensitive values redacted    |
| `http.request.resend_count`    | Number of retries performed                                                  |
| `http.response.body.size`      | Response payload bytes from `Content-Length`, when enabled and applicable    |
| `http.response.header.<name>`  | Explicitly selected response header values, with sensitive values redacted   |
| `http.response.status_code`    | Status code of the final response                                            |
| `url.full`                     | Full URL with redacted query parameters and credentials, fragment dropped    |
| `url.scheme`                   | URL scheme                                                                   |
| `url.path`                     | URL path                                                                     |
| `url.query`                    | Query string with redacted parameters (omitted when empty)                   |
| `url.template`                 | Path template when `params` are used, without query, fragment or credentials |
| `server.address`               | Hostname                                                                     |
| `server.port`                  | Explicit or scheme-default server port                                       |
| `error.type`                   | Status code for API errors, otherwise the okfetch error tag                  |
| `okfetch.error.tag`            | okfetch error tag (`ApiError`, `FetchError`, ...)                            |
| `okfetch.validation.issues`    | Formatted schema issues for validation failures                              |

Failure handling:

- `ApiError` (non-2xx): span status `ERROR`; `http.response.status_code` carries the reason, so no redundant status description is set
- `FetchError`, `TimeoutError`, `ParseError`, `PluginError`: span status `ERROR` with the error message, plus an `exception` event via `span.recordException`
- `ValidationError`: the same failure details, with formatted schema issues added to the status message, exception message and `okfetch.validation.issues`

Every retry adds an `okfetch.retry` event carrying the attempt number, the error tag, and the status code when a response was received.

### HTTP registry coverage

The plugin emits every HTTP registry attribute that applies to a Fetch client and can be observed accurately. `http.connection.state` belongs to connection-pool metrics, and `http.route` belongs to server spans, so neither applies. Fetch does not expose protocol framing or total bytes on the wire, so `http.request.size` and `http.response.size` are intentionally omitted rather than estimated. Response body size is omitted for `HEAD`, `204`, and `304` responses and whenever no valid `Content-Length` is available. Deprecated HTTP attributes are never emitted.

## Relationship To `@okfetch/fetch`

This package is just a plugin built on top of the public `OkfetchPlugin` interface from `@okfetch/fetch`. It only depends on `@opentelemetry/api`, so it works with any OpenTelemetry SDK setup.
