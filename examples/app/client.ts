// client.ts
import { createApi, validateClientErrors } from "@kanonic/fetch";

import { apiErrorSchema, endpoints } from "./endpoints";
import { loggerPlugin, timingPlugin } from "./plugins";

const api = createApi({
  baseURL: "https://jsonplaceholder.typicode.com",
  endpoints,
  errorSchema: apiErrorSchema,
  shouldValidateError: validateClientErrors,
  plugins: [loggerPlugin, timingPlugin],
  cache: "no-store",
  headers: { "X-Client": "kanonic-example" },
});

// ─── 1. Successful request ────────────────────────────────────────────────────

console.log("1. Fetching todo #1\n");

const todo = await api.todos.get({ params: { id: 1 } });

todo.match({
  err: (e) => console.error("  ✗", e.message, "\n"),
  ok: (t) => console.log(`  ✓ [${t.completed ? "x" : " "}] ${t.title}\n`),
});

// ─── 2. Typed error response ──────────────────────────────────────────────────

console.log("2. Fetching a non-existent user (expects 404)\n");

const user = await api.users.get({ params: { id: 99_999 } });

if (user.isErr()) {
  const { error } = user;

  switch (error._tag) {
    case "ApiError": {
      console.log("  HTTP", error.statusCode);
      if (error.data) {
        // Typed: { code: string; message: string; details?: ... }
        console.log("code:", error.data.code);
        console.log("  message:", error.data.message);
      } else {
        // JSONPlaceholder doesn't return structured errors, so we fall back
        console.log("  raw body:", error.text || "(empty)");
      }
      break;
    }
    case "FetchError": {
      console.log("  Network failure:", error.message);
      break;
    }
    case "TimeoutError": {
      console.log("  Request timed out:", error.message);
      break;
    }
    case "ValidationError": {
      console.log(`  Invalid ${error.type}:`, error.zodError.issues);
      break;
    }
    default: {
      console.log("  Could not parse response:", error.message);
      break;
    }
  }
  console.log();
}

// ─── 3. Input validation (caught before the network call) ─────────────────────

console.log(
  "3. Creating a todo with an empty title (expects ValidationError)\n"
);

const created = await api.todos.create({ body: { title: "", userId: 1 } });

if (created.isErr() && created.error._tag === "ValidationError") {
  console.log("  ✓ Caught before fetch:");
  for (const issue of created.error.zodError.issues) {
    console.log("", issue.path.join("."), "—", issue.message);
  }
  console.log();
}

// ─── 4. map / andThen chaining ────────────────────────────────────────────────

console.log("4. Fetch all todos and extract only the completed ones\n");

const todos = await api.todos.list();

const completedTitles = todos.map((all) =>
  all.filter((t) => t.completed).map((t) => t.title)
);

completedTitles.match({
  err: (e) => console.error("  ✗", e.message, "\n"),
  ok: (titles) => console.log(`  ✓ ${titles.length} completed todos\n`),
});

// ─── 5. Per-call overrides ────────────────────────────────────────────────────

console.log("5. Fetch todo #1 with an AbortController (not aborted)\n");

const ac = new AbortController();

const abortable = await api.todos.get(
  { params: { id: 1 } },
  { headers: { "X-Request-Id": "demo-123" }, signal: ac.signal }
);

abortable.match({
  err: (e) => console.error("  ✗", e._tag, "\n"),
  ok: (t) => console.log(`  ✓ ${t.title}\n`),
});

// ─── 6. Retry with exponential backoff ────────────────────────────────────────

console.log(
  "6. Fetch todo #1 with retry (up to 3 retries, exponential backoff)\n"
);

const retried = await api.todos.get(
  { params: { id: 1 } },
  {
    retry: {
      attempts: 3,
      initialDelay: 200,
      strategy: "exponential",
      shouldRetry: (error) => {
        if (error._tag === "FetchError") {
          return true;
        }
        return error.statusCode >= 500;
      },
    },
  }
);

retried.match({
  err: (e) => console.error("  ✗", e._tag, "\n"),
  ok: (t) => console.log(`  ✓ [${t.completed ? "x" : " "}] ${t.title}\n`),
});
