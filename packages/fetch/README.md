# @kanonic/fetch

`@kanonic/fetch` is the transport core of the kanonic ecosystem.

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
bun add @kanonic/fetch better-result zod
```

```bash
npm install @kanonic/fetch better-result zod
```

## What It Exports

Functions:

- `kanonic`
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

- `KanonicOptions`
- `KanonicError`
- `KanonicPlugin`
- `KanonicPluginHooks`
- `KanonicSuccess`
- `RetryOptions`
- `Auth`

## Quick Example

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

## Request Options

`kanonic(url, options)` accepts standard `fetch` options plus kanonic-specific behavior:

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
await kanonic("/users/:id", {
  baseURL: "https://api.example.com",
  method: "GET",
  params: { id: 42 },
  query: { include: ["teams", "profile"] },
});
```

### Validation

`outputSchema` validates successful responses:

```ts
await kanonic("https://api.example.com/me", {
  outputSchema: z.object({
    id: z.string(),
    email: z.string().email(),
  }),
});
```

`apiErrorDataSchema` validates structured error bodies when `shouldValidateError` allows it:

```ts
import { validateClientErrors } from "@kanonic/fetch";

await kanonic("https://api.example.com/me", {
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
await kanonic("https://api.example.com/me", {
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
await kanonic("https://api.example.com/me", {
  auth: {
    type: "bearer",
    token: process.env.API_TOKEN ?? "",
  },
});
```

### Plugins

Plugins are a core extension point.

```ts
import type { KanonicPlugin } from "@kanonic/fetch";

const plugin: KanonicPlugin = {
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
const result = await kanonic("https://example.com/events", {
  stream: true,
  outputSchema: z.object({
    id: z.number(),
    message: z.string(),
  }),
});
```

When an `outputSchema` is present, each SSE `data:` chunk is parsed and validated independently.

## Error Handling

`kanonic` never throws expected HTTP, parsing, timeout, or validation failures from the request API itself. Instead it returns tagged errors inside the `Result`.

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

- `@kanonic/api` builds typed API clients on top of this package
- `@kanonic/logger` provides a ready-made logging plugin
