import type {
  OkfetchError,
  OkfetchOptions,
  OkfetchPlugin,
  OkfetchPluginInitInput,
  OkfetchRequestContext,
} from "@okfetch/fetch";
import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type {
  Attributes,
  Span,
  TextMapSetter,
  Tracer,
} from "@opentelemetry/api";

const PLUGIN_NAME = "otel";
const PLUGIN_VERSION = "0.1.0";
const TRACER_NAME = "@okfetch/otel";

/** HTTP methods known by default, as defined by the HTTP semantic conventions. */
export const DEFAULT_KNOWN_HTTP_METHODS = [
  "CONNECT",
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "QUERY",
  "TRACE",
] as const;

/** Value written in place of redacted headers and query parameters. */
export const REDACTED_VALUE = "REDACTED";

/** A header or query parameter name, or a pattern tested against names. */
export type RedactionMatcher = string | RegExp;

/** A list of names and patterns whose values are redacted. */
export type RedactionList = readonly RedactionMatcher[];

/**
 * Configures what gets redacted. An array replaces the defaults entirely; a
 * function receives the defaults and returns the list to use, which makes
 * extending them a one-liner: `(defaults) => [...defaults, "x-tenant"]`.
 */
export type RedactionOption =
  | RedactionList
  | ((defaults: RedactionList) => RedactionList);

/**
 * Header and query parameter names matching this pattern are redacted even
 * when they are not listed explicitly, so vendor-specific credential fields
 * such as `X-Amz-Security-Token` or `X-Goog-Signature` never leak. It is part
 * of both default lists.
 */
export const DEFAULT_REDACTED_NAME_PATTERN =
  /auth|bearer|cred|jwt|otp|passw|private|secret|session|sig|token|api[-_]?key/i;

/** A list of patterns tested against header and query parameter values. */
export type ValuePatternList = readonly RegExp[];

/**
 * Configures value-based redaction. An array replaces the defaults; a
 * function receives the defaults and returns the list to use.
 */
export type ValuePatternOption =
  | ValuePatternList
  | ((defaults: ValuePatternList) => ValuePatternList);

/** Header names to capture, or `true` to explicitly capture every header. */
export type HeaderCaptureOption = boolean | readonly string[];

/**
 * Header and query parameter values matching one of these patterns are
 * redacted whatever their name, so a credential carried under an arbitrary
 * name (`X-JWT`, `blob`, ...) still never reaches telemetry. Covers JWTs and
 * HTTP authentication credentials (`Bearer`, `Basic`, `Digest`, ...).
 */
export const DEFAULT_REDACTED_VALUE_PATTERNS: ValuePatternList = [
  /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/,
  /^(?:Bearer|Basic|Digest|Negotiate|Token|OAuth|AWS4-HMAC-SHA256)\s/i,
];

/** Request headers whose values are never recorded on spans. */
export const DEFAULT_REDACTED_HEADERS: RedactionList = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "api-key",
  "x-amz-security-token",
  "x-amz-credential",
  "x-amz-signature",
  DEFAULT_REDACTED_NAME_PATTERN,
];

/** Query parameters whose values are never recorded on spans. */
export const DEFAULT_REDACTED_QUERY_PARAMS: RedactionList = [
  "access_token",
  "api_key",
  "apikey",
  "assertion",
  "auth",
  "authorization",
  "awsaccesskeyid",
  "client_assertion",
  "client_secret",
  "code",
  "code_verifier",
  "id_token",
  "key",
  "password",
  "refresh_token",
  "secret",
  "sig",
  "signature",
  "token",
  "x-amz-credential",
  "x-amz-security-token",
  "x-amz-signature",
  "x-goog-signature",
  DEFAULT_REDACTED_NAME_PATTERN,
];

export type OtelOptions = {
  /**
   * Tracer used to start spans. Defaults to a tracer named `@okfetch/otel`
   * obtained from the global tracer provider.
   */
  tracer?: Tracer;
  /**
   * Request headers to record as `http.request.header.<name>` attributes.
   * Sensitive values are always redacted. Defaults to no headers. Pass `true`
   * to explicitly capture every request header.
   */
  captureRequestHeaders?: HeaderCaptureOption;
  /**
   * Response headers to record as `http.response.header.<name>` attributes.
   * Sensitive values are always redacted. Defaults to no headers. Pass `true`
   * to explicitly capture every response header.
   */
  captureResponseHeaders?: HeaderCaptureOption;
  /**
   * Whether to record request and response payload sizes when Fetch exposes
   * enough information to calculate them accurately. Defaults to `false`.
   */
  captureBodySizes?: boolean;
  /**
   * Case-sensitive HTTP methods known to this instrumentation. This is a full
   * replacement for `DEFAULT_KNOWN_HTTP_METHODS`.
   */
  knownMethods?: readonly string[];
  /**
   * Whether W3C trace context headers (`traceparent`, `tracestate`) are
   * injected into the outgoing request. Defaults to `true`.
   */
  propagateTraceContext?: boolean;
  /**
   * What to redact from recorded headers and query parameters. Each entry
   * accepts an array (replaces the defaults) or a function (receives the
   * defaults and returns the list to use). Name matching is case-insensitive.
   */
  redact?: {
    /** Defaults to `DEFAULT_REDACTED_HEADERS`. */
    headers?: RedactionOption;
    /** Defaults to `DEFAULT_REDACTED_QUERY_PARAMS`. */
    queryParams?: RedactionOption;
    /**
     * Patterns matched against header and query parameter values, applied
     * regardless of name. Defaults to `DEFAULT_REDACTED_VALUE_PATTERNS`.
     */
    values?: ValuePatternOption;
  };
};

type OtelState = {
  ended: boolean;
  resendCount: number;
  span?: Span;
  template?: string;
};

type NameMatcher = (name: string) => boolean;
type ValueMatcher = (value: string) => boolean;

type ResolvedOptions = {
  captureBodySizes: boolean;
  capturedRequestHeaders: true | ReadonlySet<string>;
  capturedResponseHeaders: true | ReadonlySet<string>;
  propagateTraceContext: boolean;
  isRedactedHeader: NameMatcher;
  isRedactedQueryParam: NameMatcher;
  isRedactedValue: ValueMatcher;
  knownMethods: ReadonlySet<string>;
  tracer: Tracer;
};

const stateKey = Symbol.for("@okfetch/otel:state");

type WithState<T> = T & { [stateKey]?: OtelState };

const getState = (
  carrier: OkfetchRequestContext | OkfetchOptions
): OtelState | undefined => (carrier as WithState<typeof carrier>)[stateKey];

const pathParamPattern = /:[A-Za-z_]\w*(?=[/?#]|$)/;
const userInfoPattern = /^([a-z][a-z\d+.-]*:\/\/)[^/]*@/i;
const contentLengthPattern = /^\d+$/;

/**
 * Reduces a raw request URL to its low-cardinality absolute-path template.
 * Query values, fragments, origins, and embedded credentials are excluded.
 */
const toTemplate = (rawUrl: string): string | undefined => {
  const [withoutQuery = ""] = rawUrl.split(/[?#]/, 1);
  const withoutUserInfo = withoutQuery.replace(userInfoPattern, "$1");
  if (!pathParamPattern.test(withoutUserInfo)) {
    return undefined;
  }

  try {
    return new URL(withoutUserInfo).pathname;
  } catch {
    return withoutUserInfo;
  }
};

const headersSetter: TextMapSetter<Headers> = {
  set: (carrier, key, value) => {
    carrier.set(key, value);
  },
};

const resolveList = <T extends readonly unknown[]>(
  defaults: T,
  option: T | ((defaults: T) => T) | undefined
): T => {
  if (option === undefined) {
    return defaults;
  }
  if (Array.isArray(option)) {
    return option as T;
  }

  return (option as (defaults: T) => T)(defaults);
};

const testPattern = (pattern: RegExp, input: string): boolean => {
  pattern.lastIndex = 0;
  return pattern.test(input);
};

const createValueMatcher =
  (patterns: ValuePatternList): ValueMatcher =>
  (value) =>
    patterns.some((pattern) => testPattern(pattern, value));

const createNameMatcher = (list: RedactionList): NameMatcher => {
  const names = new Set<string>();
  const patterns: RegExp[] = [];

  for (const matcher of list) {
    if (typeof matcher === "string") {
      names.add(matcher.toLowerCase());
    } else {
      patterns.push(matcher);
    }
  }

  return (name) =>
    names.has(name.toLowerCase()) ||
    patterns.some((pattern) => testPattern(pattern, name));
};

const resolveCapturedHeaders = (
  option: HeaderCaptureOption | undefined
): true | ReadonlySet<string> =>
  option === true
    ? true
    : new Set(
        option === false || option === undefined
          ? []
          : option.map((name) => name.toLowerCase())
      );

const resolveOptions = (options: OtelOptions | undefined): ResolvedOptions => ({
  captureBodySizes: options?.captureBodySizes ?? false,
  capturedRequestHeaders: resolveCapturedHeaders(
    options?.captureRequestHeaders
  ),
  capturedResponseHeaders: resolveCapturedHeaders(
    options?.captureResponseHeaders
  ),
  propagateTraceContext: options?.propagateTraceContext ?? true,
  isRedactedHeader: createNameMatcher(
    resolveList(DEFAULT_REDACTED_HEADERS, options?.redact?.headers)
  ),
  isRedactedQueryParam: createNameMatcher(
    resolveList(DEFAULT_REDACTED_QUERY_PARAMS, options?.redact?.queryParams)
  ),
  isRedactedValue: createValueMatcher(
    resolveList(DEFAULT_REDACTED_VALUE_PATTERNS, options?.redact?.values)
  ),
  knownMethods: new Set(options?.knownMethods ?? DEFAULT_KNOWN_HTTP_METHODS),
  tracer: options?.tracer ?? trace.getTracer(TRACER_NAME, PLUGIN_VERSION),
});

const getMethodAttributes = (
  method: string,
  knownMethods: ReadonlySet<string>
): Attributes => {
  const semanticMethod = knownMethods.has(method) ? method : "_OTHER";
  const attributes: Attributes = {
    "http.request.method": semanticMethod,
  };

  if (method !== semanticMethod) {
    attributes["http.request.method_original"] = method;
  }

  return attributes;
};

const getContentLength = (headers: Headers): number | undefined => {
  const value = headers.get("content-length")?.trim();
  if (!value || !contentLengthPattern.test(value)) {
    return undefined;
  }

  const size = Number(value);
  return Number.isSafeInteger(size) ? size : undefined;
};

const getRequestBodySize = (
  body: OkfetchRequestContext["body"],
  headers: Headers
): number | undefined => {
  if (body === undefined) {
    return undefined;
  }

  const contentLength = getContentLength(headers);
  if (contentLength !== undefined) {
    return contentLength;
  }
  if (headers.has("content-encoding")) {
    return undefined;
  }
  if (typeof body === "string") {
    return new TextEncoder().encode(body).byteLength;
  }
  if (body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString()).byteLength;
  }
  if (body instanceof Blob) {
    return body.size;
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return body.byteLength;
  }

  return undefined;
};

const shouldCaptureHeader = (
  capturedHeaders: true | ReadonlySet<string>,
  name: string
): boolean => capturedHeaders === true || capturedHeaders.has(name);

const captureHeaders = (
  attributes: Attributes,
  prefix: "http.request.header" | "http.response.header",
  headers: Headers,
  capturedHeaders: true | ReadonlySet<string>,
  options: ResolvedOptions
): void => {
  for (const [name, value] of headers) {
    if (!shouldCaptureHeader(capturedHeaders, name)) {
      continue;
    }

    const shouldRedact =
      options.isRedactedHeader(name) || options.isRedactedValue(value);
    attributes[`${prefix}.${name}`] = [shouldRedact ? REDACTED_VALUE : value];
  }
};

const getServerPort = (url: URL): number | undefined => {
  if (url.port) {
    return Number(url.port);
  }
  if (url.protocol === "http:") {
    return 80;
  }
  if (url.protocol === "https:") {
    return 443;
  }

  return undefined;
};

const redactUrl = (url: URL, options: ResolvedOptions): URL => {
  const redacted = new URL(url.toString());
  redacted.hash = "";

  if (redacted.username) {
    redacted.username = REDACTED_VALUE;
  }
  if (redacted.password) {
    redacted.password = REDACTED_VALUE;
  }

  for (const name of new Set(redacted.searchParams.keys())) {
    const shouldRedact =
      options.isRedactedQueryParam(name) ||
      redacted.searchParams.getAll(name).some(options.isRedactedValue);
    if (shouldRedact) {
      redacted.searchParams.set(name, REDACTED_VALUE);
    }
  }

  return redacted;
};

const buildRequestAttributes = (
  ctx: OkfetchRequestContext,
  template: string | undefined,
  options: ResolvedOptions
): Attributes => {
  const url = redactUrl(ctx.url, options);
  const attributes: Attributes = {
    ...getMethodAttributes(ctx.method, options.knownMethods),
    "server.address": url.hostname,
    "url.full": url.toString(),
    "url.path": url.pathname,
    "url.scheme": url.protocol.replace(/:$/, ""),
  };
  const serverPort = getServerPort(url);
  if (serverPort !== undefined) {
    attributes["server.port"] = serverPort;
  }

  if (url.search) {
    attributes["url.query"] = url.search.slice(1);
  }
  if (template) {
    attributes["url.template"] = template;
  }

  if (options.captureBodySizes) {
    const bodySize = getRequestBodySize(ctx.body, ctx.headers);
    if (bodySize !== undefined) {
      attributes["http.request.body.size"] = bodySize;
    }
  }
  captureHeaders(
    attributes,
    "http.request.header",
    ctx.headers,
    options.capturedRequestHeaders,
    options
  );

  return attributes;
};

const startSpan = (
  ctx: OkfetchRequestContext,
  state: OtelState,
  options: ResolvedOptions
): Span => {
  const method = options.knownMethods.has(ctx.method) ? ctx.method : "HTTP";
  const name = state.template ? `${method} ${state.template}` : method;

  return options.tracer.startSpan(
    name,
    {
      attributes: buildRequestAttributes(ctx, state.template, options),
      kind: SpanKind.CLIENT,
    },
    context.active()
  );
};

/**
 * Injects trace context headers into a copy of the request headers. A
 * propagator failure is recorded on the span and the request proceeds without
 * propagation headers: telemetry must never fail the request or leave the
 * span open.
 */
const injectTraceContext = (
  ctx: OkfetchRequestContext,
  span: Span
): OkfetchRequestContext => {
  const headers = new Headers(ctx.headers);

  try {
    propagation.inject(
      trace.setSpan(context.active(), span),
      headers,
      headersSetter
    );
  } catch (error) {
    span.addEvent("okfetch.propagation_failed", {
      "exception.message":
        error instanceof Error ? error.message : String(error),
    });
    return ctx;
  }

  return { ...ctx, headers };
};

const endSpan = (state: OtelState): void => {
  if (state.ended) {
    return;
  }

  state.ended = true;
  state.span?.end();
};

const recordResponse = (
  span: Span,
  ctx: OkfetchRequestContext,
  response: Response,
  options: ResolvedOptions
): void => {
  const attributes: Attributes = {
    "http.response.status_code": response.status,
  };

  if (
    options.captureBodySizes &&
    ctx.method !== "HEAD" &&
    response.status !== 204 &&
    response.status !== 304
  ) {
    const bodySize = getContentLength(response.headers);
    if (bodySize !== undefined) {
      attributes["http.response.body.size"] = bodySize;
    }
  }
  captureHeaders(
    attributes,
    "http.response.header",
    response.headers,
    options.capturedResponseHeaders,
    options
  );
  span.setAttributes(attributes);
};

const recordFailure = (
  span: Span,
  ctx: OkfetchRequestContext,
  response: Response | undefined,
  error: OkfetchError<unknown>,
  options: ResolvedOptions
): void => {
  span.setAttribute("okfetch.error.tag", error._tag);

  if (response) {
    recordResponse(span, ctx, response, options);
  }

  if (error._tag === "ApiError") {
    span.setAttributes({
      "error.type": String(error.statusCode),
      "http.response.status_code": error.statusCode,
    });
    span.setStatus({ code: SpanStatusCode.ERROR });
    return;
  }

  if (error._tag === "ValidationError") {
    const issues = error.issues.map((issue) => {
      const path = issue.path
        ?.map((segment) =>
          String(typeof segment === "object" ? segment.key : segment)
        )
        .join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    });
    const message =
      issues.length > 0
        ? `${error.message}: ${issues.join("; ")}`
        : error.message;

    span.setAttribute("okfetch.validation.issues", issues);
    span.setAttribute("error.type", error._tag);
    span.recordException({ message, name: error._tag, stack: error.stack });
    span.setStatus({ code: SpanStatusCode.ERROR, message });
    return;
  }

  span.setAttribute("error.type", error._tag);
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
};

/**
 * Creates an OpenTelemetry plugin that records a single `CLIENT` span per
 * okfetch request, spanning every retry attempt.
 *
 * The span records HTTP client attributes available through Fetch and marks
 * failures using the OpenTelemetry HTTP span conventions. Request and response
 * bodies are never recorded.
 */
export const otel = (options?: OtelOptions): OkfetchPlugin => {
  const resolved = resolveOptions(options);

  const init = ({
    options: requestOptions,
    url,
  }: OkfetchPluginInitInput): OkfetchPluginInitInput => {
    const state: OtelState = {
      ended: false,
      resendCount: 0,
      template:
        requestOptions.params === undefined ? undefined : toTemplate(url),
    };
    const nextOptions: WithState<OkfetchOptions> = {
      ...requestOptions,
      [stateKey]: state,
    };

    return { options: nextOptions, url };
  };

  const onRequest = (ctx: OkfetchRequestContext): OkfetchRequestContext => {
    const state = getState(ctx) ?? { ended: false, resendCount: 0 };
    let nextCtx: WithState<OkfetchRequestContext> = {
      ...ctx,
      [stateKey]: state,
    };
    if (state.span) {
      state.resendCount += 1;
      state.span.setAttribute("http.request.resend_count", state.resendCount);
    } else {
      state.span = startSpan(nextCtx, state, resolved);
    }

    if (resolved.propagateTraceContext) {
      nextCtx = {
        ...injectTraceContext(nextCtx, state.span),
        [stateKey]: state,
      };
    }

    return nextCtx;
  };

  return {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    init,
    hooks: {
      onRequest,
      onSuccess(ctx, response) {
        const state = getState(ctx);
        if (!state?.span) {
          return;
        }

        recordResponse(state.span, ctx, response, resolved);
        endSpan(state);
      },
      onFail(ctx, response, error) {
        const state = getState(ctx);
        if (!state) {
          return;
        }

        state.span ??= startSpan(ctx, state, resolved);
        recordFailure(state.span, ctx, response, error, resolved);
        endSpan(state);
      },
      onRetry(ctx, response, error, attempt) {
        const state = getState(ctx);
        if (!state?.span) {
          return;
        }

        const attributes: Attributes = {
          "error.type":
            error._tag === "ApiError" ? String(error.statusCode) : error._tag,
          "okfetch.error.tag": error._tag,
          "okfetch.retry.attempt": attempt + 1,
        };
        if (response) {
          attributes["http.response.status_code"] = response.status;
        }

        state.span.addEvent("okfetch.retry", attributes);
      },
    },
  } satisfies OkfetchPlugin;
};
