---
name: okfetch
description: Use this skill when building with the okfetch library. It helps agents choose between @okfetch/fetch, @okfetch/api, and @okfetch/logger, and shows the expected Result-based and Zod-based usage patterns.
---

# okfetch

Use this skill when the user wants to build HTTP clients or requests with the okfetch library.

## Package selection

Choose the package based on the job:

- Use `@okfetch/fetch` for direct typed requests with validation, retries, plugins, auth, timeouts, and streaming.
- Use `@okfetch/api` when the user wants a typed client generated from endpoint definitions.
- Use `@okfetch/logger` when the user wants ready-made request logging through a plugin.

If the user has repeated endpoint calls, shared request shapes, or wants one typed client object, prefer `@okfetch/api`.

If the user just needs a few requests or wants fine-grained transport control, prefer `@okfetch/fetch`.

## Core mental model

okfetch stays close to the web platform. It makes `fetch` safer and more composable without hiding how HTTP requests work.

The main usage pattern is:

1. Define Zod schemas for request or response shapes.
2. Call `okfetch(...)` directly or generate a client with `createApi(...)`.
3. Handle the returned `Result` explicitly instead of relying on thrown request errors.

## Result handling

Request calls return a `Result`, not thrown transport or validation errors for expected failures.

Prefer examples and implementations that use:

- `.match(...)`
- `.isOk()` / `.isErr()`
- other `better-result` helpers already available to the user

Do not default to `try/catch` for normal HTTP failure handling.

## `@okfetch/fetch`

Use `okfetch(url, options)` for direct requests.

Common options:

- `outputSchema` to validate successful responses
- `apiErrorDataSchema` to validate structured error payloads
- `params` and `query` to build request URLs
- `body` for JSON request payloads
- `auth` for basic, bearer, or custom authorization headers
- `retry` for `fixed`, `linear`, or `exponential` retries
- `timeout` for request timeouts
- `plugins` for lifecycle extensions
- `stream: true` for SSE-style streaming

Prefer this shape in examples:

```ts
import { okfetch } from "@okfetch/fetch";
import { z } from "zod/v4";

const userSchema = z.object({
  id: z.number(),
  name: z.string(),
});

const result = await okfetch("https://api.example.com/users/1", {
  outputSchema: userSchema,
});

result.match({
  err: (error) => {
    console.error(error._tag, error.message);
  },
  ok: (user) => {
    console.log(user.name);
  },
});
```

When showing error validation, use `validateClientErrors` or `validateAllErrors` from `@okfetch/fetch`.

Error tags to mention when relevant:

- `FetchError`
- `TimeoutError`
- `ApiError`
- `ParseError`
- `ValidationError`
- `PluginError`

Validation boundaries to keep straight:

- `outputSchema` validates successful responses
- `apiErrorDataSchema` validates structured error bodies
- `validateClientErrors` applies validation to `4xx` responses
- `validateAllErrors` applies validation to `4xx` and `5xx` responses

## `@okfetch/api`

Use `createEndpoints(...)` plus `createApi(...)` when the user wants a typed client from endpoint definitions.

Endpoint definitions may include:

- `method`
- `path`
- `body`
- `params`
- `query`
- `output`
- `error`
- `requestOptions`
- `stream`

This package validates `body`, `params`, and `query` before sending the request, then delegates transport behavior to `@okfetch/fetch`.

Prefer this shape in examples:

```ts
import { createApi, createEndpoints } from "@okfetch/api";
import { z } from "zod/v4";

const todoSchema = z.object({
  id: z.number(),
  title: z.string(),
  completed: z.boolean(),
});

const endpoints = createEndpoints({
  todos: {
    get: {
      method: "GET",
      output: todoSchema,
      params: z.object({ id: z.number() }),
      path: "/todos/:id",
    },
  },
});

const api = createApi({
  baseURL: "https://api.example.com",
  endpoints,
});

const result = await api.todos.get({ params: { id: 1 } });
```

Use `ApiService` when the user wants a class wrapper around a generated client.

```ts
import { ApiService, createEndpoints } from "@okfetch/api";
import { z } from "zod/v4";

const todoSchema = z.object({
  id: z.number(),
  title: z.string(),
  completed: z.boolean(),
});

const endpoints = createEndpoints({
  todos: {
    getById: {
      method: "GET",
      output: todoSchema,
      params: z.object({ id: z.number() }),
      path: "/todos/:id",
    },
  },
});

class TodoService extends ApiService(endpoints) {
  constructor() {
    super({
      baseURL: "https://api.example.com",
    });
  }

  getById(id: number) {
    return this.client.todos.getById({
      params: { id },
    });
  }
}

const todoService = new TodoService();
const result = await todoService.getById(1);
```

Important behavior:

- global `createApi(...)` options act as shared transport defaults
- per-endpoint `requestOptions` refine behavior for one endpoint
- per-call overrides win over endpoint-level and global defaults
- response parsing, retries, auth, plugins, timeouts, and streaming still come from `@okfetch/fetch`

## `@okfetch/logger`

Use `logger()` from `@okfetch/logger` as a plugin for request lifecycle logging.

Prefer this shape in examples:

```ts
import { okfetch } from "@okfetch/fetch";
import { logger } from "@okfetch/logger";

await okfetch("https://api.example.com/health", {
  plugins: [logger()],
});
```

When useful, mention `logDataOnSuccess` as the main option for including parsed success payloads in logs.

The logger plugin covers these lifecycle moments:

- request start
- success
- failure
- retry

## Streaming

When the user asks about streaming or server-sent events:

- use `stream: true`
- explain that each SSE `data:` chunk is parsed independently
- if `outputSchema` is present, explain that each chunk is validated before emission

## Guidance for answers

- Keep examples TypeScript-first.
- Use `zod/v4` in examples.
- Prefer consumer-facing code snippets over repository implementation details.
- Keep the distinction between transport concerns and endpoint-definition concerns clear.
- If a user asks which package to use, answer with a recommendation, not a neutral dump of all APIs.
