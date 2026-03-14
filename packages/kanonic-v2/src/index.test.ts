// oxlint-disable jest/no-conditional-in-test
import { describe, expect, test } from "bun:test";

import type { Result } from "better-result";
import { z } from "zod/v4";

import { ValidationError } from "./errors";
import type {
  KanonicError,
  KanonicFetch,
  KanonicPlugin,
  KanonicPluginInitInput,
} from "./index";
import { kanonic } from "./index";

const createMockFetch =
  (handler: (request: Request) => Response | Promise<Response>): KanonicFetch =>
  async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? input : new Request(String(input), init);
    return handler(request);
  };

const createRejectingFetch =
  (message: string): KanonicFetch =>
  async () => {
    throw new TypeError(message);
  };

const createSSEStream = (chunks: (string | object)[]) => {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        const data = typeof chunk === "string" ? chunk : JSON.stringify(chunk);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }
      controller.close();
    },
  });
};

const collectStreamChunks = async <T>(
  stream: ReadableStream<T>
): Promise<T[]> => {
  const chunks: T[] = [];
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return chunks;
};

const createValidatorPlugin = (schemas: {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
}): KanonicPlugin => ({
  name: "validator",
  version: "1.0.0",
  init: ({ options, url }) => {
    if (schemas.params) {
      const parsedParams = schemas.params.safeParse(options.params ?? {});
      if (!parsedParams.success) {
        throw new ValidationError({
          type: "params",
          message: "Invalid params",
          zodError: parsedParams.error,
        });
      }
    }

    if (schemas.query) {
      const parsedQuery = schemas.query.safeParse(options.query ?? {});
      if (!parsedQuery.success) {
        throw new ValidationError({
          type: "query",
          message: "Invalid query",
          zodError: parsedQuery.error,
        });
      }
    }

    if (schemas.body) {
      const parsedBody = schemas.body.safeParse(options.body);
      if (!parsedBody.success) {
        throw new ValidationError({
          type: "body",
          message: "Invalid body",
          zodError: parsedBody.error,
        });
      }
    }

    return { url, options };
  },
});

describe("kanonic v2 plugins", () => {
  test("executes init hooks in order and rewrites raw url and options", async () => {
    let finalInput: KanonicPluginInitInput | undefined;
    let requestUrl = "";
    let requestHeader = "";

    const mockFetch = createMockFetch((request) => {
      requestUrl = request.url;
      requestHeader = request.headers.get("x-init") ?? "";
      return Response.json({ ok: true });
    });

    const result = await kanonic<{ ok: boolean }, unknown>("/todos/:id", {
      baseURL: "https://api.example.com",
      fetch: mockFetch,
      headers: { "x-start": "yes" },
      params: { id: 1 },
      plugins: [
        {
          name: "rewrite-url",
          version: "1.0.0",
          init: ({ options, url: rawUrl }) => ({
            options: {
              ...options,
              params: { id: 42 },
            },
            url: `${rawUrl}?from=init`,
          }),
        },
        {
          name: "capture",
          version: "1.0.0",
          init: (input) => {
            finalInput = input;
            return {
              ...input,
              options: {
                ...input.options,
                headers: {
                  ...input.options.headers,
                  "x-init": "done",
                },
              },
            };
          },
        },
      ],
    });

    expect(result.isOk()).toBe(true);
    expect(finalInput?.url).toBe("/todos/:id?from=init");
    expect(finalInput?.options.params).toEqual({ id: 42 });
    expect(requestUrl).toBe("https://api.example.com/todos/42?from=init");
    expect(requestHeader).toBe("done");
  });

  test("onRequest mutations are threaded to later plugins and fetch", async () => {
    const seen: string[] = [];
    let authHeader = "";

    const mockFetch = createMockFetch((request) => {
      authHeader = request.headers.get("authorization") ?? "";
      return Response.json({ ok: true });
    });

    const result = await kanonic<{ ok: boolean }, unknown>("/resource", {
      baseURL: "https://api.example.com",
      fetch: mockFetch,
      plugins: [
        {
          name: "first",
          version: "1.0.0",
          hooks: {
            onRequest: (context) => {
              context.headers.set("authorization", "Bearer token-123");
              seen.push(context.headers.get("authorization") ?? "");
              return context;
            },
          },
        },
        {
          name: "second",
          version: "1.0.0",
          hooks: {
            onRequest: (context) => {
              seen.push(context.headers.get("authorization") ?? "");
              return context;
            },
          },
        },
      ],
    });

    expect(result.isOk()).toBe(true);
    expect(seen).toEqual(["Bearer token-123", "Bearer token-123"]);
    expect(authHeader).toBe("Bearer token-123");
  });

  test("onResponse can replace the response used for parsing", async () => {
    const mockFetch = createMockFetch(() => Response.json({ ok: false }));

    const result = await kanonic<{ ok: boolean }, unknown>("/resource", {
      baseURL: "https://api.example.com",
      fetch: mockFetch,
      plugins: [
        {
          name: "replace-response",
          version: "1.0.0",
          hooks: {
            onResponse: () => Response.json({ ok: true }),
          },
        },
      ],
      outputSchema: z.object({
        ok: z.boolean(),
      }),
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.ok).toBe(true);
    }
  });

  test("onSuccess fires once after retries eventually succeed", async () => {
    let attempts = 0;
    const events: string[] = [];
    const observerPlugin: KanonicPlugin = {
      name: "observer",
      version: "1.0.0",
      hooks: {
        onRetry: (_context, response, error, attempt) => {
          events.push(
            `retry:${attempt}:${response?.status ?? "none"}:${error._tag}`
          );
        },
        onSuccess: (_context, response, data) => {
          const parsedData = data as { ok: boolean };
          events.push(`success:${response.status}:${String(parsedData.ok)}`);
        },
      },
    };

    const mockFetch = createMockFetch(() => {
      attempts += 1;
      if (attempts < 3) {
        return new Response("boom", { status: 503, statusText: "Unavailable" });
      }

      return Response.json({ ok: true });
    });

    const result = await kanonic<{ ok: boolean }, unknown>("/resource", {
      baseURL: "https://api.example.com",
      fetch: mockFetch,
      plugins: [observerPlugin],
      retry: {
        strategy: "fixed",
        attempts: 2,
      },
    });

    expect(result.isOk()).toBe(true);
    expect(events).toEqual([
      "retry:0:503:ApiError",
      "retry:1:503:ApiError",
      "success:200:true",
    ]);
  });

  test("onFail fires once on terminal transport failure with no response", async () => {
    const events: string[] = [];
    const mockFetch = createRejectingFetch("network down");

    const result = await kanonic("https://example.com", {
      fetch: mockFetch,
      plugins: [
        {
          name: "observer",
          version: "1.0.0",
          hooks: {
            onFail: (_context, response, error) => {
              events.push(`fail:${response === undefined}:${error._tag}`);
            },
          },
        },
      ],
    });

    expect(result.isErr()).toBe(true);
    expect(events).toEqual(["fail:true:FetchError"]);
  });

  test("side-effect hook failures are swallowed", async () => {
    const mockFetch = createMockFetch(() => Response.json({ ok: true }));

    const result = await kanonic<{ ok: boolean }, unknown>("/resource", {
      baseURL: "https://api.example.com",
      fetch: mockFetch,
      plugins: [
        {
          name: "noisy",
          version: "1.0.0",
          hooks: {
            onSuccess: () => {
              throw new Error("ignore me");
            },
          },
        },
      ],
    });

    expect(result.isOk()).toBe(true);
  });

  test("unexpected mutating hook failures become PluginError", async () => {
    const result = await kanonic("https://example.com", {
      plugins: [
        {
          name: "broken",
          version: "1.0.0",
          init: () => {
            throw new Error("boom");
          },
        },
      ],
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error._tag === "PluginError") {
      expect(result.error._tag).toBe("PluginError");
      expect(result.error.pluginName).toBe("broken");
      expect(result.error.hook).toBe("init");
    }
  });

  test("existing KanonicError thrown by plugin is preserved", async () => {
    const parsed = z.object({ id: z.string() }).safeParse({ id: 1 });
    if (parsed.success) {
      throw new Error("Expected invalid query fixture");
    }

    const result = await kanonic("https://example.com", {
      plugins: [
        {
          name: "validator",
          version: "1.0.0",
          hooks: {
            onRequest: () => {
              throw new ValidationError({
                type: "query",
                message: "Nope",
                zodError: parsed.error,
              });
            },
          },
        },
      ],
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error._tag === "ValidationError") {
      expect(result.error._tag).toBe("ValidationError");
      expect(result.error.type).toBe("query");
    }
  });

  test("validator plugins can short-circuit before fetch", async () => {
    let calls = 0;
    const mockFetch = createMockFetch(() => {
      calls += 1;
      return Response.json({ ok: true });
    });

    const result = await kanonic("https://example.com/todos/:id", {
      body: { title: 42 },
      fetch: mockFetch,
      params: { id: "bad" },
      plugins: [
        createValidatorPlugin({
          body: z.object({ title: z.string() }),
          params: z.object({ id: z.number() }),
        }),
      ],
    });

    expect(result.isErr()).toBe(true);
    expect(calls).toBe(0);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ValidationError");
    }
  });

  test("onRetry receives undefined response on transport failures", async () => {
    const events: string[] = [];
    let calls = 0;
    const mockFetch = createMockFetch(() => {
      calls += 1;
      throw new TypeError("offline");
    });

    const result = await kanonic("https://example.com", {
      fetch: mockFetch,
      plugins: [
        {
          name: "observer",
          version: "1.0.0",
          hooks: {
            onRetry: (_context, response, error, attempt) => {
              events.push(
                `retry:${attempt}:${response === undefined}:${error._tag}`
              );
            },
          },
        },
      ],
      retry: {
        strategy: "fixed",
        attempts: 1,
      },
    });

    expect(result.isErr()).toBe(true);
    expect(calls).toBe(2);
    expect(events).toEqual(["retry:0:true:FetchError"]);
  });

  test("stream returns ReadableStream of parsed chunks", async () => {
    const mockFetch = createMockFetch(
      () => new Response(createSSEStream(["hello", "world"]))
    );
    const options = {
      fetch: mockFetch,
      stream: true as const,
    };

    const result = await kanonic<string, unknown>(
      "https://example.com/stream",
      options
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const chunks = await collectStreamChunks(result.value);
      expect(chunks).toEqual(["hello", "world"]);
    }
  });

  test("stream validates each chunk with output schema", async () => {
    const mockFetch = createMockFetch(
      () => new Response(createSSEStream([{ id: 1 }, { id: 2 }]))
    );
    const options = {
      fetch: mockFetch,
      outputSchema: z.object({
        id: z.number(),
      }),
      stream: true as const,
    };

    const result = await kanonic<{ id: number }, unknown>(
      "https://example.com/stream",
      options
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const chunks = await collectStreamChunks(result.value);
      expect(chunks).toEqual([{ id: 1 }, { id: 2 }]);
    }
  });

  test("stream errors when a chunk does not match output schema", async () => {
    const mockFetch = createMockFetch(
      () => new Response(createSSEStream([{ id: 1 }, { id: "bad" }]))
    );
    const options = {
      fetch: mockFetch,
      outputSchema: z.object({
        id: z.number(),
      }),
      stream: true as const,
    };

    const result = await kanonic<{ id: number }, unknown>(
      "https://example.com/stream",
      options
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const reader = result.value.getReader();
      const firstChunk = await reader.read();
      expect(firstChunk.value).toEqual({ id: 1 });
      await expect(reader.read()).rejects.toMatchObject({
        _tag: "ValidationError",
        type: "output",
      });
      reader.releaseLock();
    }
  });

  test("manual success generic works with stream and defaults error to unknown", () => {
    const mockFetch = createMockFetch(
      () => new Response(createSSEStream(["hello", "world"]))
    );

    const resultPromise: Promise<
      Result<ReadableStream<string>, KanonicError<unknown>>
    > = kanonic<string>("https://example.com/stream", {
      fetch: mockFetch,
      stream: true as const,
    });

    expect(resultPromise).toBeInstanceOf(Promise);
  });
});
