# @okfetch/fetch

`@okfetch/fetch` is the transport core of the okfetch ecosystem.

It wraps the standard `fetch` API with:

- `Result`-based error handling via `better-result`
- Zod-powered response validation
- request retries and timeouts
- auth helpers
- lifecycle plugins
- SSE-style stream parsing

If you want typed HTTP calls without building a full generated client, this is the package to start with.

## Installation

```bash
bun add @okfetch/fetch better-result zod
```

```bash
npm install @okfetch/fetch better-result zod
```

## What It Exports

Functions:

- `okfetch`
- `validateClientErrors`
- `validateAllErrors`

Errors:

- `FetchError`
- `TimeoutError`
- `ApiError`
- `ParseError`
- `ValidationError`
- `PluginError`

Types:

- `OkfetchOptions`
- `OkfetchError`
- `OkfetchPlugin`
- `OkfetchPluginHooks`
- `OkfetchSuccess`
- `RetryOptions`
- `Auth`

## Quick Example

```ts
import { okfetch } from "@okfetch/fetch";
import { z } from "zod/v4";

const todoSchema = z.object({
  completed: z.boolean(),
  id: z.number(),
  title: z.string(),
  userId: z.number(),
});

const result = await okfetch("https://jsonplaceholder.typicode.com/todos/1", {
  outputSchema: todoSchema,
});

result.match({
  err: (error) => console.error(error._tag, error.message),
  ok: (todo) => console.log(todo.title),
});
```

## Request Options

`okfetch(url, options)` accepts standard `fetch` options plus okfetch-specific behavior:

- `outputSchema`
- `apiErrorDataSchema`
- `baseURL`
- `params`
- `query`
- `body`
- `auth`
- `timeout`
- `stream`
- `validateOutput`
- `shouldValidateError`
- `plugins`
- `retry`
- `fetch`

### URL building

You can pass a fully qualified URL directly, or combine a relative path with `baseURL`.

Path params are replaced from `params`, and query strings are built from `query`.

```ts
await okfetch("/users/:id", {
  baseURL: "https://api.example.com",
  method: "GET",
  params: { id: 42 },
  query: { include: ["teams", "profile"] },
});
```

### Validation

`outputSchema` validates successful responses:

```ts
await okfetch("https://api.example.com/me", {
  outputSchema: z.object({
    id: z.string(),
    email: z.string().email(),
  }),
});
```

`apiErrorDataSchema` validates structured error bodies when `shouldValidateError` allows it:

```ts
import { validateClientErrors } from "@okfetch/fetch";

await okfetch("https://api.example.com/me", {
  apiErrorDataSchema: z.object({
    code: z.string(),
    message: z.string(),
  }),
  shouldValidateError: validateClientErrors,
});
```

### Retries

Supported strategies:

- `fixed`
- `linear`
- `exponential`

```ts
await okfetch("https://api.example.com/me", {
  retry: {
    attempts: 3,
    initialDelay: 100,
    strategy: "exponential",
  },
});
```

### Auth

Built-in auth shapes:

- `{ type: "basic", username, password }`
- `{ type: "bearer", token }`
- `{ type: "custom", prefix, value }`

```ts
await okfetch("https://api.example.com/me", {
  auth: {
    type: "bearer",
    token: process.env.API_TOKEN ?? "",
  },
});
```

### Plugins

Plugins are a core extension point.

```ts
import type { OkfetchPlugin } from "@okfetch/fetch";

const plugin: OkfetchPlugin = {
  name: "timing",
  version: "1.0.0",
  hooks: {
    onRequest(context) {
      console.log("->", context.method, context.url.toString());
      return context;
    },
    onFail(_context, _response, error) {
      console.error(error._tag, error.message);
    },
  },
};
```

Available lifecycle hooks:

- `init`
- `onRequest`
- `onResponse`
- `onSuccess`
- `onFail`
- `onRetry`

### Streaming

Set `stream: true` to receive a `ReadableStream`.

```ts
const result = await okfetch("https://example.com/events", {
  stream: true,
  outputSchema: z.object({
    id: z.number(),
    message: z.string(),
  }),
});
```

When an `outputSchema` is present, each SSE `data:` chunk is parsed and validated independently.

## Error Handling

`okfetch` never throws expected HTTP, parsing, timeout, or validation failures from the request API itself. Instead it returns tagged errors inside the `Result`.

Use `match` when you want explicit branching:

```ts
result.match({
  err: (error) => {
    if (error._tag === "ApiError") {
      console.error(error.statusCode, error.data);
    }
  },
  ok: (data) => console.log(data),
});
```

## Related Packages

- `@okfetch/api` builds typed API clients on top of this package
- `@okfetch/logger` provides a ready-made logging plugin
