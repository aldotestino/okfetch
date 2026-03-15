# @kanonic/api

`@kanonic/api` builds typed API clients from endpoint definitions.

It sits on top of `@kanonic/fetch` and adds:

- schema-defined endpoint trees
- typed method generation
- request-side validation for `body`, `params`, and `query`
- a small `ApiService` helper for class-based usage

Use this package when you have more than a few repeated API calls and want one source of truth for request and response shapes.

## Installation

```bash
bun add @kanonic/api @kanonic/fetch better-result zod
```

```bash
npm install @kanonic/api @kanonic/fetch better-result zod
```

## What It Exports

Functions:

- `createEndpoints`
- `createApi`
- `ApiService`

Types:

- `Endpoint`
- `EndpointTree`
- `EndpointCallOptions`
- `EndpointRequestOverrides`
- `EndpointFunction`
- `ApiClient`
- `ApiErrors`
- `CreateApiOptions`

## Quick Example

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

## Defining Endpoints

Each endpoint can describe:

- `method`
- `path`
- `body`
- `params`
- `query`
- `output`
- `error`
- `requestOptions`
- `stream`

```ts
const endpoints = createEndpoints({
  users: {
    list: {
      method: "GET",
      output: z.array(z.object({ id: z.number(), name: z.string() })),
      path: "/users",
    },
    get: {
      method: "GET",
      output: z.object({ id: z.number(), name: z.string() }),
      params: z.object({ id: z.number() }),
      path: "/users/:id",
    },
  },
});
```

## Creating A Client

`createApi` accepts global transport defaults and applies them to every generated endpoint method.

```ts
const api = createApi({
  baseURL: "https://api.example.com",
  endpoints,
  headers: { "x-client": "web-app" },
  timeout: 5000,
});
```

Per-call overrides win over endpoint-level and global defaults.

```ts
await api.users.get(
  { params: { id: 1 } },
  {
    headers: { "x-request-id": crypto.randomUUID() },
    timeout: 1000,
  }
);
```

## Validation Behavior

By default, `@kanonic/api` validates:

- `body`
- `params`
- `query`

before the network call is sent.

It delegates response parsing, retries, streaming, auth, plugins, and error handling to `@kanonic/fetch`.

Useful options:

- `validateInput`
- `validateOutput`
- `errorSchema`
- `shouldValidateError`

```ts
import { validateClientErrors } from "@kanonic/fetch";

const api = createApi({
  baseURL: "https://api.example.com",
  endpoints,
  errorSchema: z.object({
    code: z.string(),
    message: z.string(),
  }),
  shouldValidateError: validateClientErrors,
});
```

## Streaming Endpoints

Set `stream: true` on an endpoint to receive a typed `ReadableStream`.

```ts
const endpoints = createEndpoints({
  events: {
    method: "GET",
    output: z.object({
      id: z.number(),
      message: z.string(),
    }),
    path: "/events",
    stream: true,
  },
});
```

## ApiService

`ApiService` is a small helper for teams that prefer a class wrapper around a generated client.

```ts
import { ApiService, createEndpoints } from "@kanonic/api";
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

## Relationship To `@kanonic/fetch`

`@kanonic/api` does not replace `@kanonic/fetch`; it composes it.

Choose `@kanonic/fetch` when:

- you only need a few direct requests
- you want total control over each request
- you are building your own abstractions

Choose `@kanonic/api` when:

- your app has a shared API surface
- you want endpoint schemas in one place
- you want generated, typed methods instead of repeated request objects
