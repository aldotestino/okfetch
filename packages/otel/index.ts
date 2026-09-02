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

/** Value written in place of redacted headers and query parameters. */
export const REDACTED_VALUE = "[REDACTED]";

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
  /auth|credential|passw|secret|session|sig|token|api[-_]?key/i;

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
  "auth",
  "authorization",
  "awsaccesskeyid",
  "client_secret",
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
   * Whether request headers are recorded as `http.request.header.<name>`
   * attributes. Sensitive headers are always redacted. Defaults to `true`.
   */
  captureRequestHeaders?: boolean;
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
  };
};

type OtelState = {
  ended: boolean;
  resendCount: number;
  span?: Span;
  template?: string;
};

type NameMatcher = (name: string) => boolean;

type ResolvedOptions = {
  captureRequestHeaders: boolean;
  propagateTraceContext: boolean;
  isRedactedHeader: NameMatcher;
  isRedactedQueryParam: NameMatcher;
  tracer: Tracer;
};

const stateKey = Symbol.for("@okfetch/otel:state");

type WithState<T> = T & { [stateKey]?: OtelState };

const getState = (
  carrier: OkfetchRequestContext | OkfetchOptions
): OtelState | undefined => (carrier as WithState<typeof carrier>)[stateKey];

const pathParamPattern = /:[A-Za-z_]\w*(?=[/?#]|$)/;
const userInfoPattern = /^([a-z][a-z\d+.-]*:\/\/)[^/]*@/i;

/**
 * Reduces a raw request url to its low-cardinality template: the query,
 * fragment and any embedded credentials are dropped so only the scheme, host
 * and path with `:param` placeholders remain.
 */
const toTemplate = (rawUrl: string): string | undefined => {
  const [withoutQuery = ""] = rawUrl.split(/[?#]/, 1);
  const template = withoutQuery.replace(userInfoPattern, "$1");

  return pathParamPattern.test(template) ? template : undefined;
};

const headersSetter: TextMapSetter<Headers> = {
  set: (carrier, key, value) => {
    carrier.set(key, value);
  },
};

const resolveRedactionList = (
  defaults: RedactionList,
  option: RedactionOption | undefined
): RedactionList => {
  if (option === undefined) {
    return defaults;
  }

  return typeof option === "function" ? option(defaults) : option;
};

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
    patterns.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(name);
    });
};

const resolveOptions = (options: OtelOptions | undefined): ResolvedOptions => ({
  captureRequestHeaders: options?.captureRequestHeaders ?? true,
  propagateTraceContext: options?.propagateTraceContext ?? true,
  isRedactedHeader: createNameMatcher(
    resolveRedactionList(DEFAULT_REDACTED_HEADERS, options?.redact?.headers)
  ),
  isRedactedQueryParam: createNameMatcher(
    resolveRedactionList(
      DEFAULT_REDACTED_QUERY_PARAMS,
      options?.redact?.queryParams
    )
  ),
  tracer: options?.tracer ?? trace.getTracer(TRACER_NAME, PLUGIN_VERSION),
});

const redactUrl = (url: URL, isRedactedQueryParam: NameMatcher): URL => {
  const redacted = new URL(url.toString());
  redacted.hash = "";

  if (redacted.username) {
    redacted.username = REDACTED_VALUE;
  }
  if (redacted.password) {
    redacted.password = REDACTED_VALUE;
  }

  for (const name of new Set(redacted.searchParams.keys())) {
    if (isRedactedQueryParam(name)) {
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
  const url = redactUrl(ctx.url, options.isRedactedQueryParam);
  const attributes: Attributes = {
    "http.request.method": ctx.method,
    "server.address": url.hostname,
    "url.full": url.toString(),
    "url.path": url.pathname,
    "url.scheme": url.protocol.replace(/:$/, ""),
  };

  if (url.port) {
    attributes["server.port"] = Number(url.port);
  }
  if (url.search) {
    attributes["url.query"] = url.search.slice(1);
  }
  if (template) {
    attributes["url.template"] = template;
  }

  if (options.captureRequestHeaders) {
    for (const [name, value] of ctx.headers) {
      attributes[`http.request.header.${name}`] = [
        options.isRedactedHeader(name) ? REDACTED_VALUE : value,
      ];
    }
  }

  return attributes;
};

const startSpan = (
  ctx: OkfetchRequestContext,
  state: OtelState,
  options: ResolvedOptions
): Span => {
  const name = state.template ? `${ctx.method} ${state.template}` : ctx.method;

  return options.tracer.startSpan(
    name,
    {
      attributes: buildRequestAttributes(ctx, state.template, options),
      kind: SpanKind.CLIENT,
    },
    context.active()
  );
};

const injectTraceContext = (
  ctx: OkfetchRequestContext,
  span: Span
): OkfetchRequestContext => {
  const headers = new Headers(ctx.headers);
  propagation.inject(
    trace.setSpan(context.active(), span),
    headers,
    headersSetter
  );

  return { ...ctx, headers };
};

const endSpan = (state: OtelState): void => {
  if (state.ended) {
    return;
  }

  state.ended = true;
  state.span?.end();
};

const recordFailure = (
  span: Span,
  response: Response | undefined,
  error: OkfetchError<unknown>
): void => {
  span.setAttribute("okfetch.error.tag", error._tag);

  if (error._tag === "ApiError") {
    span.setAttributes({
      "error.type": String(error.statusCode),
      "http.response.status_code": error.statusCode,
      "http.response.status_text": error.statusText,
    });
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `${error.statusCode} ${error.statusText}`.trim(),
    });
    return;
  }

  if (response) {
    span.setAttributes({
      "http.response.status_code": response.status,
      "http.response.status_text": response.statusText,
    });
  }

  span.setAttribute("error.type", error._tag);
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
};

/**
 * Creates an OpenTelemetry plugin that records a single `CLIENT` span per
 * okfetch request, spanning every retry attempt.
 *
 * The span records the request method, URL, path, query, and headers (with
 * sensitive values redacted), the response status, and marks the span as
 * failed with the status code and text when the request errors. Request and
 * response bodies are never recorded.
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

        state.span.setAttribute("http.response.status_code", response.status);
        endSpan(state);
      },
      onFail(ctx, response, error) {
        const state = getState(ctx);
        if (!state?.span) {
          return;
        }

        recordFailure(state.span, response, error);
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
