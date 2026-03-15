[![CI](https://github.com/aldotestino/kanonic/actions/workflows/ci.yml/badge.svg)](https://github.com/aldotestino/kanonic/actions/workflows/ci.yml)

# kanonic

`kanonic` is a small family of TypeScript-first HTTP packages built around one idea: make `fetch` safer and more composable without hiding how the web platform works.

The repo is split into focused packages:

- `@kanonic/fetch` for direct typed requests with validation, retries, plugins, timeouts, auth, and streaming
- `@kanonic/api` for schema-defined endpoint trees that generate a typed API client
- `@kanonic/logger` for a ready-made `pino` plugin you can drop into request flows

All request execution is based on [`better-result`](https://github.com/dmmulroy/better-result), so success and failure stay explicit as data instead of being pushed into exception-based control flow.

## Packages

| Package           | What it does                                                       | Best for                                                 |
| ----------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| `@kanonic/fetch`  | Direct `fetch` wrapper with runtime validation and lifecycle hooks | Low-level requests and shared transport config           |
| `@kanonic/api`    | Typed API client generated from endpoint definitions               | Larger applications with repeated API calls              |
| `@kanonic/logger` | `pino`-based plugin for kanonic hooks                              | Request/response logging without writing your own plugin |

Package-level docs:

- [packages/fetch/README.md](/Users/aldotestino/Developer/kanonic/packages/fetch/README.md)
- [packages/api/README.md](/Users/aldotestino/Developer/kanonic/packages/api/README.md)
- [packages/logger/README.md](/Users/aldotestino/Developer/kanonic/packages/logger/README.md)

## Why kanonic

- Validate response payloads with Zod before they reach business logic
- Validate endpoint `body`, `params`, and `query` before a request is sent
- Handle transport and API failures with typed `Result` values
- Reuse cross-cutting concerns through plugins instead of ad hoc wrappers
- Add retries, auth, timeouts, and streaming without giving up standard `fetch`

## Installation

### Direct fetch usage

```bash
bun add @kanonic/fetch better-result zod
```

```bash
npm install @kanonic/fetch better-result zod
```

### Typed API client usage

```bash
bun add @kanonic/api @kanonic/fetch better-result zod
```

```bash
npm install @kanonic/api @kanonic/fetch better-result zod
```

### Logging plugin

```bash
bun add @kanonic/logger @kanonic/fetch pino
```

```bash
npm install @kanonic/logger @kanonic/fetch pino
```

## Quick Start

### 1. Direct requests with `@kanonic/fetch`

```ts
import { kanonic } from "@kanonic/fetch";
import { z } from "zod/v4";

const todoSchema = z.object({
  completed: z.boolean(),
  id: z.number(),
  title: z.string(),
  userId: z.number(),
});

const result = await kanonic("https://jsonplaceholder.typicode.com/todos/1", {
  outputSchema: todoSchema,
});

result.match({
  err: (error) => console.error(error._tag, error.message),
  ok: (todo) => console.log(todo.title),
});
```

### 2. Typed clients with `@kanonic/api`

```ts
import { createApi, createEndpoints } from "@kanonic/api";
import { z } from "zod/v4";

const todoSchema = z.object({
  completed: z.boolean(),
  id: z.number(),
  title: z.string(),
  userId: z.number(),
});

const endpoints = createEndpoints({
  todos: {
    get: {
      method: "GET",
      output: todoSchema,
      params: z.object({ id: z.number() }),
      path: "/todos/:id",
    },
    create: {
      body: z.object({
        title: z.string().min(1),
        userId: z.number(),
      }),
      method: "POST",
      output: todoSchema,
      path: "/todos",
    },
  },
});

const api = createApi({
  baseURL: "https://jsonplaceholder.typicode.com",
  endpoints,
});

const result = await api.todos.get({ params: { id: 1 } });
```

### 3. Logging with `@kanonic/logger`

```ts
import { kanonic } from "@kanonic/fetch";
import { logger } from "@kanonic/logger";

const result = await kanonic("https://example.com/health", {
  plugins: [logger()],
});
```

## How The Packages Fit Together

`@kanonic/fetch` is the transport core. It owns request execution, retries, streaming support, auth, plugin execution, timeout behavior, and parsing.

`@kanonic/api` sits on top of `@kanonic/fetch`. It turns endpoint definitions into typed client methods and injects request validation based on the schemas attached to each endpoint.

`@kanonic/logger` is optional sugar. It is just a plugin package built on the public `KanonicPlugin` interface from `@kanonic/fetch`.

## Core Concepts

### `Result` instead of thrown request errors

Both direct requests and generated client calls resolve to a `Result`.

That means callers can use `.isOk()`, `.isErr()`, `.map()`, `.match()`, and other `better-result` helpers instead of relying on `try/catch` for expected HTTP and validation failures.

### Validation

`@kanonic/fetch` can validate:

- successful response bodies with `outputSchema`
- structured API error payloads with `apiErrorDataSchema`
- stream chunks when `stream: true` is enabled

`@kanonic/api` adds request-side validation for:

- `body`
- `params`
- `query`

Helpers from `@kanonic/fetch`:

```ts
import { validateAllErrors, validateClientErrors } from "@kanonic/fetch";
```

- `validateClientErrors` validates only `4xx` responses
- `validateAllErrors` validates both `4xx` and `5xx` responses

### Retries and timeouts

Retries support:

- `"fixed"`
- `"linear"`
- `"exponential"`

You can set them globally or per request:

```ts
await kanonic("https://api.example.com/users/1", {
  retry: {
    attempts: 3,
    initialDelay: 200,
    strategy: "exponential",
  },
  timeout: 5000,
});
```

### Plugins

Plugins can participate in the request lifecycle through:

- `init`
- `onRequest`
- `onResponse`
- `onSuccess`
- `onFail`
- `onRetry`

This makes it easy to add logging, tracing, metrics, request rewriting, custom auth, or any other cross-cutting concern once and reuse it everywhere.

### Streaming

Set `stream: true` to receive a `ReadableStream`.

```ts
import { kanonic } from "@kanonic/fetch";
import { z } from "zod/v4";

const result = await kanonic("https://example.com/events", {
  stream: true,
  outputSchema: z.object({
    id: z.number(),
    message: z.string(),
  }),
});
```

Each SSE `data:` chunk is parsed independently. If you pass an `outputSchema`, each chunk is validated before it is emitted by the stream.

## Error Model

`@kanonic/fetch` returns tagged errors:

- `FetchError`
- `TimeoutError`
- `ApiError`
- `ParseError`
- `ValidationError`
- `PluginError`

`ValidationError.type` identifies the failing boundary:

- `"body"`
- `"query"`
- `"params"`
- `"output"`
- `"error"`

## Example App

A small runnable example lives in [examples/app/index.ts](/Users/aldotestino/Developer/kanonic/examples/app/index.ts).

Run it with:

```bash
bun run --cwd examples/app dev
```

It demonstrates:

- one direct `kanonic(...)` call
- one generated typed API client
- one request-side validation failure

## Development

Useful commands from the repo root:

```bash
bun x ultracite fix
```

```bash
bun x ultracite check
```

```bash
bun test packages/fetch/src/index.test.ts
```

```bash
bun test packages/api/src/index.test.ts
```
