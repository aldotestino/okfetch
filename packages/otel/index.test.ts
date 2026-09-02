import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";

import type { OkfetchFetch, OkfetchPlugin } from "@okfetch/fetch";
import { okfetch, ValidationError } from "@okfetch/fetch";
import {
  context,
  propagation,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

import {
  DEFAULT_REDACTED_HEADERS,
  DEFAULT_REDACTED_NAME_PATTERN,
  DEFAULT_REDACTED_QUERY_PARAMS,
  otel,
  REDACTED_VALUE,
} from "./index";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const tracer = provider.getTracer("okfetch-otel-test");
const contextManager = new AsyncLocalStorageContextManager();

beforeAll(() => {
  context.setGlobalContextManager(contextManager.enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
});

beforeEach(() => {
  exporter.reset();
});

afterAll(async () => {
  context.disable();
  propagation.disable();
  await provider.shutdown();
});

const createMockFetch = (
  handler: (request: Request, attempt: number) => Response | Promise<Response>
): { fetch: OkfetchFetch; requests: Request[] } => {
  const requests: Request[] = [];
  const fetch: OkfetchFetch = async (input, init) => {
    const request =
      input instanceof Request ? input : new Request(String(input), init);
    requests.push(request);
    return handler(request, requests.length - 1);
  };

  return { fetch, requests };
};

const rejectingFetch: OkfetchFetch = async () => {
  throw new TypeError("connection refused");
};

const respondAfterFailures =
  (failures: number) =>
  (_request: Request, attempt: number): Response =>
    attempt < failures
      ? new Response("boom", { status: 503, statusText: "Unavailable" })
      : Response.json({ ok: true });

const numericIdSchema = {
  "~standard": {
    validate: (value: unknown) =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as { id?: unknown }).id === "number"
        ? { value }
        : { issues: [{ message: "id must be a number" }] },
    vendor: "test",
    version: 1 as const,
  },
};

const getSingleSpan = (): ReadableSpan => {
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);
  return spans[0] as ReadableSpan;
};

describe("@okfetch/otel", () => {
  test("records a single client span with url, method, query and redacted headers", async () => {
    const { fetch } = createMockFetch(() => Response.json({ ok: true }));

    const result = await okfetch("https://api.example.com/todos", {
      auth: { token: "super-secret", type: "bearer" },
      fetch,
      headers: {
        Accept: "application/json",
        "X-Api-Key": "another-secret",
      },
      plugins: [otel({ tracer })],
      query: { page: 2, token: "query-secret" },
    });

    expect(result.isOk()).toBe(true);

    const span = getSingleSpan();
    expect(span.name).toBe("GET");
    expect(span.kind).toBe(2);
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
    expect(span.attributes).toMatchObject({
      "http.request.header.accept": ["application/json"],
      "http.request.header.authorization": [REDACTED_VALUE],
      "http.request.header.x-api-key": [REDACTED_VALUE],
      "http.request.method": "GET",
      "http.response.status_code": 200,
      "server.address": "api.example.com",
      "url.full": `https://api.example.com/todos?page=2&token=${encodeURIComponent(REDACTED_VALUE)}`,
      "url.path": "/todos",
      "url.query": `page=2&token=${encodeURIComponent(REDACTED_VALUE)}`,
      "url.scheme": "https",
    });
    expect(span.attributes["http.request.header.traceparent"]).toBeUndefined();
    expect(JSON.stringify(span.attributes)).not.toContain("super-secret");
    expect(JSON.stringify(span.attributes)).not.toContain("another-secret");
    expect(JSON.stringify(span.attributes)).not.toContain("query-secret");
  });

  test("never records the request body", async () => {
    const { fetch } = createMockFetch(() => Response.json({ ok: true }));

    await okfetch("https://api.example.com/todos", {
      body: { password: "body-secret", title: "hello" },
      fetch,
      method: "POST",
      plugins: [otel({ tracer })],
    });

    const span = getSingleSpan();
    expect(span.name).toBe("POST");
    expect(span.attributes["http.request.method"]).toBe("POST");
    expect(JSON.stringify(span.attributes)).not.toContain("body-secret");
    expect(JSON.stringify(span.events)).not.toContain("body-secret");
  });

  test("uses the path template as span name and url.template when params are used", async () => {
    const { fetch } = createMockFetch(() => Response.json({ ok: true }));

    await okfetch("/todos/:id", {
      baseURL: "https://api.example.com",
      fetch,
      params: { id: 42 },
      plugins: [otel({ tracer })],
    });

    const span = getSingleSpan();
    expect(span.name).toBe("GET /todos/:id");
    expect(span.attributes["url.template"]).toBe("/todos/:id");
    expect(span.attributes["url.path"]).toBe("/todos/42");
    expect(span.attributes["url.full"]).toBe(
      "https://api.example.com/todos/42"
    );
  });

  test("records status code and text on api errors", async () => {
    const { fetch } = createMockFetch(() =>
      Response.json(
        { message: "nope" },
        { status: 404, statusText: "Not Found" }
      )
    );

    const result = await okfetch("https://api.example.com/todos/1", {
      fetch,
      plugins: [otel({ tracer })],
    });

    expect(result.isErr()).toBe(true);

    const span = getSingleSpan();
    expect(span.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "404 Not Found",
    });
    expect(span.attributes).toMatchObject({
      "error.type": "404",
      "http.response.status_code": 404,
      "http.response.status_text": "Not Found",
      "okfetch.error.tag": "ApiError",
    });
    expect(JSON.stringify(span.attributes)).not.toContain("nope");
    expect(span.events).toHaveLength(0);
  });

  test("records transport failures as exceptions", async () => {
    const result = await okfetch("https://api.example.com/todos", {
      fetch: rejectingFetch,
      plugins: [otel({ tracer })],
    });

    expect(result.isErr()).toBe(true);

    const span = getSingleSpan();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe("Fetch request failed");
    expect(span.attributes["error.type"]).toBe("FetchError");
    expect(span.attributes["okfetch.error.tag"]).toBe("FetchError");
    expect(span.attributes["http.response.status_code"]).toBeUndefined();
    expect(span.events).toHaveLength(1);
    expect(span.events[0]?.name).toBe("exception");
  });

  test("marks the span as failed when a successful response fails validation", async () => {
    const { fetch } = createMockFetch(() => Response.json({ id: "oops" }));
    const result = await okfetch("https://api.example.com/todos/1", {
      fetch,
      outputSchema: numericIdSchema,
      plugins: [otel({ tracer })],
    });

    expect(result.isErr()).toBe(true);

    const span = getSingleSpan();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes).toMatchObject({
      "error.type": "ValidationError",
      "http.response.status_code": 200,
      "okfetch.error.tag": "ValidationError",
    });
  });

  test("keeps a single span across retries and records each retry as an event", async () => {
    const { fetch, requests } = createMockFetch(respondAfterFailures(2));

    const result = await okfetch("https://api.example.com/todos", {
      fetch,
      plugins: [otel({ tracer })],
      retry: { attempts: 3, delay: 0, strategy: "fixed" },
    });

    expect(result.isOk()).toBe(true);
    expect(requests).toHaveLength(3);

    const span = getSingleSpan();
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
    expect(span.attributes["http.request.resend_count"]).toBe(2);
    expect(span.attributes["http.response.status_code"]).toBe(200);
    expect(span.events.map((event) => event.name)).toEqual([
      "okfetch.retry",
      "okfetch.retry",
    ]);
    expect(span.events[0]?.attributes).toMatchObject({
      "error.type": "503",
      "http.response.status_code": 503,
      "okfetch.error.tag": "ApiError",
      "okfetch.retry.attempt": 1,
    });
    expect(span.events[1]?.attributes).toMatchObject({
      "okfetch.retry.attempt": 2,
    });
  });

  test("records the final failure when retries are exhausted", async () => {
    const { fetch, requests } = createMockFetch(
      () => new Response("boom", { status: 500, statusText: "Server Error" })
    );

    const result = await okfetch("https://api.example.com/todos", {
      fetch,
      plugins: [otel({ tracer })],
      retry: { attempts: 1, delay: 0, strategy: "fixed" },
    });

    expect(result.isErr()).toBe(true);
    expect(requests).toHaveLength(2);

    const span = getSingleSpan();
    expect(span.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "500 Server Error",
    });
    expect(span.attributes["http.request.resend_count"]).toBe(1);
    expect(span.events).toHaveLength(1);
  });

  test("injects trace context headers into the outgoing request", async () => {
    const { fetch, requests } = createMockFetch(() =>
      Response.json({ ok: true })
    );

    await okfetch("https://api.example.com/todos", {
      fetch,
      plugins: [otel({ tracer })],
    });

    const span = getSingleSpan();
    const traceparent = requests[0]?.headers.get("traceparent");
    expect(traceparent).toBe(
      `00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`
    );
  });

  test("skips trace context injection when disabled", async () => {
    const { fetch, requests } = createMockFetch(() =>
      Response.json({ ok: true })
    );

    await okfetch("https://api.example.com/todos", {
      fetch,
      plugins: [otel({ propagateTraceContext: false, tracer })],
    });

    getSingleSpan();
    expect(requests[0]?.headers.has("traceparent")).toBe(false);
  });

  test("becomes a child of the active span", async () => {
    const { fetch } = createMockFetch(() => Response.json({ ok: true }));
    const parent = tracer.startSpan("parent");

    await context.with(trace.setSpan(context.active(), parent), () =>
      okfetch("https://api.example.com/todos", {
        fetch,
        plugins: [otel({ tracer })],
      })
    );
    parent.end();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    const [child, parentSpan] = spans;
    expect(child?.name).toBe("GET");
    expect(parentSpan?.name).toBe("parent");
    expect(child?.parentSpanContext?.spanId).toBe(
      parentSpan?.spanContext().spanId
    );
  });

  test("supports disabling header capture and extending redaction lists", async () => {
    const { fetch } = createMockFetch(() => Response.json({ ok: true }));

    await okfetch("https://api.example.com/todos", {
      fetch,
      headers: { "X-Tenant": "acme" },
      plugins: [otel({ captureRequestHeaders: false, tracer })],
    });

    const withoutHeaders = getSingleSpan();
    expect(
      Object.keys(withoutHeaders.attributes).some((key) =>
        key.startsWith("http.request.header.")
      )
    ).toBe(false);

    exporter.reset();

    await okfetch("https://api.example.com/todos", {
      fetch,
      headers: { "X-Tenant": "acme", "X-Trace-Me": "keep" },
      plugins: [
        otel({
          redactedHeaders: ["x-tenant"],
          redactedQueryParams: ["Customer"],
          tracer,
        }),
      ],
      query: { customer: "c-1", page: 1 },
    });

    const span = getSingleSpan();
    expect(span.attributes["http.request.header.x-tenant"]).toEqual([
      REDACTED_VALUE,
    ]);
    expect(span.attributes["http.request.header.x-trace-me"]).toEqual(["keep"]);
    expect(span.attributes["url.query"]).toBe(
      `customer=${encodeURIComponent(REDACTED_VALUE)}&page=1`
    );
  });

  test("redacts AWS SigV4 credentials in headers and presigned urls", async () => {
    const { fetch } = createMockFetch(() => Response.json({ ok: true }));

    await okfetch("https://bucket.s3.amazonaws.com/object", {
      fetch,
      headers: {
        "X-Amz-Content-Sha256": "digest",
        "X-Amz-Date": "20260902T000000Z",
        "X-Amz-Security-Token": "session-secret",
      },
      plugins: [otel({ tracer })],
      query: {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": "AKIA/20260902/us-east-1/s3/aws4_request",
        "X-Amz-Expires": 300,
        "X-Amz-Security-Token": "session-secret",
        "X-Amz-Signature": "deadbeef",
      },
    });

    const span = getSingleSpan();
    const serialized = JSON.stringify(span.attributes);
    expect(serialized).not.toContain("session-secret");
    expect(serialized).not.toContain("AKIA");
    expect(serialized).not.toContain("deadbeef");
    expect(span.attributes["http.request.header.x-amz-security-token"]).toEqual(
      [REDACTED_VALUE]
    );
    expect(span.attributes["http.request.header.x-amz-date"]).toEqual([
      "20260902T000000Z",
    ]);
    expect(span.attributes["url.query"]).toContain(
      "X-Amz-Algorithm=AWS4-HMAC-SHA256"
    );
    expect(span.attributes["url.query"]).toContain("X-Amz-Expires=300");
    expect(span.attributes["url.query"]).toContain(
      `X-Amz-Credential=${encodeURIComponent(REDACTED_VALUE)}`
    );
    expect(span.attributes["url.query"]).toContain(
      `X-Amz-Signature=${encodeURIComponent(REDACTED_VALUE)}`
    );
  });

  test("redacts unlisted credential-like names and accepts custom patterns", async () => {
    const { fetch } = createMockFetch(() => Response.json({ ok: true }));

    await okfetch("https://api.example.com/todos", {
      fetch,
      headers: {
        "X-Custom-Secret": "hidden",
        "X-Internal-Ref": "ref-1",
        "X-Session-Id": "sess-1",
      },
      plugins: [otel({ redactedHeaders: [/^x-internal-/i], tracer })],
      query: { clientSecret: "hidden", idempotencyKey: "keep", page: 1 },
    });

    const span = getSingleSpan();
    expect(span.attributes["http.request.header.x-custom-secret"]).toEqual([
      REDACTED_VALUE,
    ]);
    expect(span.attributes["http.request.header.x-session-id"]).toEqual([
      REDACTED_VALUE,
    ]);
    expect(span.attributes["http.request.header.x-internal-ref"]).toEqual([
      REDACTED_VALUE,
    ]);
    expect(span.attributes["url.query"]).toBe(
      `clientSecret=${encodeURIComponent(REDACTED_VALUE)}&idempotencyKey=keep&page=1`
    );
  });

  test("redacts credentials embedded in the url", async () => {
    const { fetch } = createMockFetch(() => Response.json({ ok: true }));

    await okfetch("https://user:pass@api.example.com/todos", {
      fetch,
      plugins: [otel({ tracer })],
    });

    const span = getSingleSpan();
    expect(span.attributes["url.full"]).toBe(
      `https://${encodeURIComponent(REDACTED_VALUE)}:${encodeURIComponent(REDACTED_VALUE)}@api.example.com/todos`
    );
  });

  test("does not start a span when an earlier init hook fails", async () => {
    const { fetch, requests } = createMockFetch(() =>
      Response.json({ ok: true })
    );
    const failingValidator: OkfetchPlugin = {
      name: "validator",
      version: "1.0.0",
      init: () => {
        throw new ValidationError({
          issues: [{ message: "invalid" }],
          message: "Invalid params",
          type: "params",
        });
      },
    };

    const result = await okfetch("https://api.example.com/todos", {
      fetch,
      plugins: [failingValidator, otel({ tracer })],
    });

    expect(result.isErr()).toBe(true);
    expect(requests).toHaveLength(0);
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  test("ends the span when a later plugin's onRequest throws", async () => {
    const { fetch, requests } = createMockFetch(() =>
      Response.json({ ok: true })
    );
    const brokenRequest: OkfetchPlugin = {
      name: "broken-request",
      version: "1.0.0",
      hooks: {
        onRequest: () => {
          throw new Error("boom");
        },
      },
    };

    const result = await okfetch("https://api.example.com/todos", {
      fetch,
      plugins: [otel({ tracer }), brokenRequest],
    });

    expect(result.isErr()).toBe(true);
    expect(requests).toHaveLength(0);

    const span = getSingleSpan();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes["error.type"]).toBe("PluginError");
    expect(span.attributes["http.response.status_code"]).toBeUndefined();
  });

  test("ends the span when the response body cannot be read", async () => {
    const brokenBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("broken body"));
      },
    });
    const { fetch } = createMockFetch(
      () => new Response(brokenBody, { status: 200 })
    );

    const result = await okfetch("https://api.example.com/todos", {
      fetch,
      plugins: [otel({ tracer })],
    });

    expect(result.isErr()).toBe(true);

    const span = getSingleSpan();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes).toMatchObject({
      "error.type": "ParseError",
      "http.response.status_code": 200,
      "okfetch.error.tag": "ParseError",
    });
  });

  test("exposes the default redaction lists", () => {
    expect(DEFAULT_REDACTED_HEADERS).toContain("authorization");
    expect(DEFAULT_REDACTED_HEADERS).toContain("x-amz-security-token");
    expect(DEFAULT_REDACTED_QUERY_PARAMS).toContain("token");
    expect(DEFAULT_REDACTED_QUERY_PARAMS).toContain("x-amz-signature");
    expect(DEFAULT_REDACTED_NAME_PATTERN.test("X-Goog-Signature")).toBe(true);
    expect(DEFAULT_REDACTED_NAME_PATTERN.test("content-type")).toBe(false);
  });
});
