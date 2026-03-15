[![CI](https://github.com/aldotestino/kanonic/actions/workflows/ci.yml/badge.svg)](https://github.com/aldotestino/kanonic/actions/workflows/ci.yml)

# kanonic

`kanonic` is a type-safe wrapper around `fetch` with Zod validation and `Result`-based error handling.

It gives you two layers:

- `kanonic(url, options)` for one-off requests
- `createEndpoints` + `createApi` for typed API clients generated from schemas

Every request returns a `Result`, so success and failure stay explicit without relying on thrown exceptions in normal control flow.

## Installation

```bash
bun add @kanonic/fetch zod better-result
```

```bash
npm install @kanonic/fetch zod better-result
```

## Why use it

- Validate request input and response output with Zod
- Generate typed client methods from a single endpoint tree
- Handle failures as data with `Result`
- Add retries, timeouts, auth, plugins, and streaming on top of standard `fetch`

## Quick Start

### Direct request

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

### Typed client

```ts
import { createApi, createEndpoints } from "@kanonic/fetch";
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

Endpoint methods use:

- the first argument for schema-backed `body`, `params`, and `query`
- the optional second argument for overrides like `headers`, `timeout`, `retry`, `signal`, `fetch`, and `plugins`

Endpoints without request schemas accept only the override argument.

## Example App

The example app is intentionally small and lives in one file:

```bash
bun run --cwd examples/app dev
```

It demonstrates:

- one direct `kanonic(...)` request
- one generated typed client
- one validation error caught before a network call is sent

See [examples/app/main.ts](/Users/aldotestino/Developer/kanonic/examples/app/main.ts).

## Core Concepts

### Validation

`createApi` validates endpoint `body`, `params`, and `query` by default. Response validation is controlled with `validateOutput`.

To validate structured API error bodies, pass an `errorSchema` and optionally control when it runs with `shouldValidateError`.

Helpers are included:

```ts
import { validateAllErrors, validateClientErrors } from "@kanonic/fetch";
```

- `validateClientErrors` validates only `4xx`
- `validateAllErrors` validates `4xx` and `5xx`

### Request configuration

Global defaults go into `createApi(...)`, and per-call overrides win.

```ts
const api = createApi({
  baseURL: "https://api.example.com",
  endpoints,
  auth: { type: "bearer", token: "secret" },
  headers: { "x-app": "kanonic" },
  timeout: 5000,
});
```

```ts
await api.todos.get(
  { params: { id: 1 } },
  {
    timeout: 1000,
    retry: {
      attempts: 2,
      initialDelay: 200,
      strategy: "exponential",
    },
  }
);
```

### Streaming

Set `stream: true` on a request or endpoint to receive a typed `ReadableStream`.

```ts
const result = await kanonic("https://example.com/events", {
  stream: true,
  outputSchema: z.object({
    id: z.number(),
    message: z.string(),
  }),
});
```

Each SSE `data:` chunk is parsed independently and validated against `outputSchema`.

### Plugins

Plugins are optional. They can modify request input up front and observe the request lifecycle through hooks like `init`, `onRequest`, `onResponse`, `onSuccess`, `onFail`, and `onRetry`.

### ApiService

`ApiService` is a thin class wrapper around `createApi` when you prefer an OO entrypoint.

```ts
import { ApiService, createEndpoints } from "@kanonic/fetch";
import { z } from "zod/v4";

const endpoints = createEndpoints({
  posts: {
    getById: {
      method: "GET",
      output: z.object({ id: z.number(), title: z.string() }),
      params: z.object({ id: z.number() }),
      path: "/posts/:id",
    },
  },
});

class BlogService extends ApiService(endpoints) {
  constructor() {
    super({ baseURL: "https://jsonplaceholder.typicode.com" });
  }
}
```

## Error Types

`kanonic` returns tagged errors:

- `FetchError`
- `TimeoutError`
- `ApiError`
- `ParseError`
- `ValidationError`
- `PluginError`

`ValidationError.type` tells you which boundary failed:

- `"body"`
- `"query"`
- `"params"`
- `"output"`
- `"error"`
