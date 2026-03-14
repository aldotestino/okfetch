[![CI](https://github.com/aldotestino/kanonic/actions/workflows/ci.yml/badge.svg)](https://github.com/aldotestino/kanonic/actions/workflows/ci.yml)

# kanonic

`kanonic` is a type-safe wrapper around `fetch` built on top of [`better-result`](https://github.com/dmmulroy/better-result).

It gives you two layers:

- `kanonic(url, options)` for direct calls with typed results, retries, plugins, validation, and streaming
- `createEndpoints` + `createApi` + `ApiService` for building typed trees of API methods from Zod schemas

Every request returns a `Result`, so callers handle success and failure explicitly instead of relying on thrown exceptions.

## Installation

```bash
# bun
bun add @kanonic/fetch zod better-result

# npm
npm install @kanonic/fetch zod better-result
```

## Direct Usage

```ts
import { kanonic } from "@kanonic/fetch";
import { z } from "zod/v4";

const result = await kanonic("https://jsonplaceholder.typicode.com/todos/1", {
  outputSchema: z.object({
    id: z.number(),
    title: z.string(),
    completed: z.boolean(),
    userId: z.number(),
  }),
});

result.match({
  ok: (todo) => console.log(todo.title),
  err: (error) => console.error(error._tag, error.message),
});
```

## Typed Client

```ts
import {
  createApi,
  createEndpoints,
  validateClientErrors,
} from "@kanonic/fetch";
import { z } from "zod/v4";

const todoSchema = z.object({
  id: z.number(),
  userId: z.number(),
  title: z.string(),
  completed: z.boolean(),
});

const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

const endpoints = createEndpoints({
  todos: {
    getById: {
      method: "GET",
      path: "/todos/:id",
      params: z.object({ id: z.number() }),
      output: todoSchema,
    },
    create: {
      method: "POST",
      path: "/todos",
      body: z.object({
        title: z.string().min(1),
        userId: z.number(),
      }),
      output: todoSchema,
    },
  },
});

const api = createApi({
  baseURL: "https://jsonplaceholder.typicode.com",
  endpoints,
  errorSchema: apiErrorSchema,
  shouldValidateError: validateClientErrors,
  headers: { "x-client": "kanonic" },
});

const result = await api.todos.getById({ params: { id: 1 } });
```

Endpoint calls use:

- first argument: `{ body, query, params }` for the schemas defined on that endpoint
- second optional argument: per-call overrides like `headers`, `timeout`, `retry`, `signal`, `fetch`, `plugins`

Zero-schema endpoints accept only the optional override argument.

## Streaming

Set `stream: true` on an endpoint or request to receive `ReadableStream<T>`.

```ts
const streamResult = await kanonic<string>("https://example.com/events", {
  stream: true,
});
```

With an `outputSchema`, each SSE `data:` chunk is parsed and validated individually.

```ts
const result = await kanonic("https://example.com/events", {
  stream: true,
  outputSchema: z.object({
    id: z.number(),
    message: z.string(),
  }),
});
```

When using the typed client:

```ts
const endpoints = createEndpoints({
  events: {
    method: "GET",
    path: "/events",
    output: z.object({ id: z.number() }),
    stream: true,
  },
});
```

## Validation Knobs

`kanonic` and `createApi` support the main runtime validation controls:

- `validateInput?: boolean`
  The typed client uses this to enable or disable body/query/params validation from endpoint schemas. Defaults to `true`.
- `validateOutput?: boolean`
  Controls response and stream-chunk output validation. Defaults to `true`.
- `shouldValidateError?: (statusCode: number) => boolean`
  Controls when an `errorSchema` should be applied. By default, error bodies are not parsed.

Helpers are included:

```ts
import { validateAllErrors, validateClientErrors } from "@kanonic/fetch";
```

- `validateClientErrors` validates only `4xx`
- `validateAllErrors` validates both `4xx` and `5xx`

## Plugins

Plugins can rewrite inputs before request normalization and observe or mutate the request lifecycle.

```ts
import type { KanonicPlugin } from "@kanonic/fetch";

const loggerPlugin: KanonicPlugin = {
  name: "logger",
  version: "1.0.0",
  hooks: {
    onRequest(context) {
      console.log("->", context.method, context.url);
      return context;
    },
    onResponse(context, response) {
      console.log("<-", response.status, context.url);
      return response;
    },
    onFail(_context, _response, error) {
      console.error(error._tag, error.message);
    },
  },
};
```

Plugin hooks:

- `init({ url, options })`
- `onRequest(context)`
- `onResponse(context, response)`
- `onSuccess(context, response, data)`
- `onFail(context, response, error)`
- `onRetry(context, response, error, attempt)`

The typed client uses the same plugin system internally to validate endpoint `body`, `query`, and `params` schemas before the request is sent.

## Request Configuration

Global defaults are passed directly to `createApi(...)`:

```ts
const api = createApi({
  baseURL: "https://api.example.com",
  endpoints,
  auth: { type: "bearer", token: "secret" },
  headers: { "x-app": "demo" },
  timeout: 5000,
  fetch: customFetch,
});
```

Endpoint definitions can provide `requestOptions`, and per-call overrides win over both global and endpoint defaults.

```ts
const api = createApi({ baseURL, endpoints });

await api.todos.getById(
  { params: { id: 1 } },
  {
    headers: { "x-request-id": crypto.randomUUID() },
    timeout: 1000,
    retry: {
      attempts: 2,
      strategy: "exponential",
      initialDelay: 200,
    },
  }
);
```

## Error Model

`kanonic` returns tagged errors:

- `FetchError`
- `TimeoutError`
- `ApiError`
- `ParseError`
- `ValidationError`
- `PluginError`

`ValidationError.type` distinguishes the failing boundary:

- `"body"`
- `"query"`
- `"params"`
- `"output"`
- `"error"`

## ApiService

`ApiService` keeps endpoint definitions at class-definition time and runtime config in the constructor.

```ts
import { ApiService, createEndpoints } from "@kanonic/fetch";

const endpoints = createEndpoints({
  posts: {
    getById: {
      method: "GET",
      path: "/posts/:id",
      params: z.object({ id: z.number() }),
      output: z.object({ id: z.number(), title: z.string() }),
    },
  },
});

class BlogService extends ApiService(endpoints) {
  constructor() {
    super({ baseURL: "https://jsonplaceholder.typicode.com" });
  }
}
```

## Examples

Updated runnable examples live in:

- [`examples/app/client.ts`](/Users/aldotestino/Developer/kanonic/examples/app/client.ts)
- [`examples/app/service.ts`](/Users/aldotestino/Developer/kanonic/examples/app/service.ts)
- [`examples/app/stream.ts`](/Users/aldotestino/Developer/kanonic/examples/app/stream.ts)
- [`examples/app/plugins.ts`](/Users/aldotestino/Developer/kanonic/examples/app/plugins.ts)

## Current Status

The canonical implementation now lives in [`packages/kanonic`](/Users/aldotestino/Developer/kanonic/packages/kanonic) and is published as `@kanonic/fetch`.

The README and runnable examples reflect the current API surface:

- direct `kanonic(...)` usage
- typed clients via `createEndpoints`, `createApi`, and `ApiService`
- plugin-based request lifecycle hooks
- validation controls, retries, and streaming
