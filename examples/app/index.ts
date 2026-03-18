import { createApi, createEndpoints } from "@okfetch/api";
import { okfetch } from "@okfetch/fetch";
import { logger } from "@okfetch/logger";
import { z } from "zod/v4";

const formatIssuePath = (
  path: readonly (PropertyKey | { key: PropertyKey })[] | undefined
) =>
  path
    ?.map((segment) =>
      typeof segment === "object" && "key" in segment
        ? String(segment.key)
        : String(segment)
    )
    .join(".") ?? "body";

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
      params: z.object({ id: z.number().int().positive() }),
      path: "/todos/:id",
    },
    create: {
      body: z.object({
        title: z.string().min(1),
        userId: z.number().int().positive(),
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
  headers: {
    "x-demo": "okfetch-example",
  },
  plugins: [logger()],
});

console.log("1. Direct request with schema validation\n");

const directTodo = await okfetch(
  "https://jsonplaceholder.typicode.com/todos/1",
  {
    outputSchema: todoSchema,
  }
);

directTodo.match({
  err: (error) => console.error(`  ${error._tag}: ${error.message}\n`),
  ok: (todo) =>
    console.log(
      `  #${todo.id}: ${todo.title} (${todo.completed ? "done" : "open"})\n`
    ),
});

console.log("2. Typed client generated from endpoint definitions\n");

const typedTodo = await api.todos.get({ params: { id: 2 } });

typedTodo.match({
  err: (error) => console.error(`  ${error._tag}: ${error.message}\n`),
  ok: (todo) => console.log(`  fetched via client: ${todo.title}\n`),
});

console.log("3. Input validation happens before the request is sent\n");

const invalidTodo = await api.todos.create({
  body: {
    title: "",
    userId: 1,
  },
});

if (invalidTodo.isErr() && invalidTodo.error._tag === "ValidationError") {
  for (const issue of invalidTodo.error.issues) {
    console.log(`  ${formatIssuePath(issue.path)}: ${issue.message}`);
  }
}
