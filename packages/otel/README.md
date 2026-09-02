# @okfetch/otel

`@okfetch/otel` is an [OpenTelemetry](https://opentelemetry.io/) tracing plugin for okfetch request lifecycles.

It gives you a ready-made `OkfetchPlugin` that records **one `CLIENT` span per request**, covering every retry attempt, with:

- the request method, URL, path, and query string
- request headers, with sensitive values redacted
- the response status code
- the status code and status text when the request fails
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

Put `otel()` after plugins that add headers if you want those headers captured on the span.

## API

`otel(options?)`

Options:

- `tracer?: Tracer` - tracer used to start spans. Defaults to `trace.getTracer("@okfetch/otel")` from the global provider.
- `captureRequestHeaders?: boolean` - record request headers as `http.request.header.<name>` attributes. Defaults to `true`.
- `propagateTraceContext?: boolean` - inject W3C `traceparent` / `tracestate` headers into the request. Defaults to `true`.
- `redact?: { headers?, queryParams?, values? }` - what to redact. `headers` and `queryParams` match names; `values` matches header and query values regardless of name. Each entry is either an array that **replaces** the defaults, or a function that **receives the defaults** and returns the list to use.

```ts
otel({
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
- `DEFAULT_REDACTED_QUERY_PARAMS` - common credential parameter names such as `token`, `access_token`, `api_key`, `password`, `secret`, `signature`, the OAuth grant parameters `code`, `code_verifier`, `client_assertion`, `assertion`, the AWS SigV4 presigned-URL fields `X-Amz-Credential`, `X-Amz-Security-Token`, `X-Amz-Signature`, plus `DEFAULT_REDACTED_NAME_PATTERN`
- `DEFAULT_REDACTED_NAME_PATTERN` - a pattern included in both default lists; any name containing `auth`, `bearer`, `cred`, `jwt`, `otp`, `passw`, `private`, `secret`, `session`, `sig`, `token`, or `api-key` is redacted even when not listed explicitly. Replacing a list with an array drops it, so include it yourself if you still want it.
- `DEFAULT_REDACTED_VALUE_PATTERNS` - patterns applied to every header and query value whatever its name: JWTs (`eyJ...` with three segments) and HTTP authentication credentials (`Bearer`, `Basic`, `Digest`, `Negotiate`, `Token`, `OAuth`, `AWS4-HMAC-SHA256` prefixes)
- `RedactionMatcher`, `RedactionList`, `RedactionOption`, `ValuePatternList`, `ValuePatternOption` - the types behind the `redact` option
- `REDACTED_VALUE` - the `[REDACTED]` placeholder written in place of redacted values

Name matching is case-insensitive for both headers and query parameters. Redaction errs on the side of hiding too much: a name such as `X-Session-Id` is redacted because it matches the default pattern, and a JWT sent under a harmless-looking name is redacted because of its value.

## What It Records

Span name: `{method}`, or `{method} {path template}` when the request uses `params` (for example `GET /todos/:id`).

Attributes follow the OpenTelemetry HTTP semantic conventions where one exists:

| Attribute                    | Value                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `http.request.method`        | Request method                                                               |
| `url.full`                   | Full URL with redacted query parameters and credentials, fragment dropped    |
| `url.scheme`                 | URL scheme                                                                   |
| `url.path`                   | URL path                                                                     |
| `url.query`                  | Query string with redacted parameters (omitted when empty)                   |
| `url.template`               | Path template when `params` are used, without query, fragment or credentials |
| `server.address`             | Hostname                                                                     |
| `server.port`                | Port when explicitly present in the URL                                      |
| `http.request.header.<name>` | Request header values, redacted for sensitive headers                        |
| `http.request.resend_count`  | Number of retries performed                                                  |
| `http.response.status_code`  | Status code of the final response                                            |
| `http.response.status_text`  | Status text of the final response, on failures                               |
| `error.type`                 | Status code for API errors, otherwise the okfetch error tag                  |
| `okfetch.error.tag`          | okfetch error tag (`ApiError`, `FetchError`, ...)                            |
| `okfetch.validation.issues`  | Formatted schema issues for validation failures                              |

Failure handling:

- `ApiError` (non-2xx): span status `ERROR` with message `{status code} {status text}`
- `FetchError`, `TimeoutError`, `ParseError`, `PluginError`: span status `ERROR` with the error message, plus an `exception` event via `span.recordException`
- `ValidationError`: the same failure details, with formatted schema issues added to the status message, exception message and `okfetch.validation.issues`

Every retry adds an `okfetch.retry` event carrying the attempt number, the error tag, and the status code when a response was received.

## Relationship To `@okfetch/fetch`

This package is just a plugin built on top of the public `OkfetchPlugin` interface from `@okfetch/fetch`. It only depends on `@opentelemetry/api`, so it works with any OpenTelemetry SDK setup.
