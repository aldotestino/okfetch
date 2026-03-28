/**
 * Public types for `@okfetch/fetch`.
 *
 * @since 0.3.1
 */
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type {
  ApiError,
  FetchError,
  ParseError,
  PluginError,
  TimeoutError,
  ValidationError,
} from "./errors";
import type { Prettify } from "./type-utils";

/**
 * Union of all tagged errors that can be returned by `okfetch`.
 *
 * @category models
 * @since 0.3.1
 */
export type OkfetchError<TErr> =
  | FetchError
  | ApiError<TErr>
  | ParseError
  | PluginError
  | ValidationError
  | TimeoutError;

/**
 * Errors eligible for retry evaluation.
 *
 * @category models
 * @since 0.3.1
 */
export type RetryableOkfetchError =
  | FetchError
  | ApiError<unknown>
  | TimeoutError;

type BasicAuth = {
  type: "basic";
  username: string;
  password: string;
};

type BearerAuth = {
  type: "bearer";
  token: string;
};

type CustomAuth = {
  type: "custom";
  prefix: string;
  value: string;
};

/**
 * Supported authorization helpers for outgoing requests.
 *
 * @category models
 * @since 0.3.1
 */
export type Auth = BasicAuth | BearerAuth | CustomAuth;

/**
 * HTTP methods that never send a request body.
 *
 * @category models
 * @since 0.3.1
 */
export type NonBodyMethods = "HEAD" | "OPTIONS";

/**
 * HTTP methods that can send a request body.
 *
 * @category models
 * @since 0.3.1
 */
export type BodyMethods = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/**
 * Supported request methods.
 *
 * @category models
 * @since 0.3.1
 */
export type Method = BodyMethods | NonBodyMethods;

type FixedRetryOptions = {
  strategy: "fixed";
  /** Maximum number of retry attempts. */
  attempts: number;
  /** Delay in milliseconds between retries. Defaults to 0. */
  delay?: number;
  /**
   * Optional callback to decide whether a given error should be retried.
   * If not provided, FetchError, TimeoutError, and ApiError with status >= 500
   * are retried by default.
   */
  shouldRetry?: (error: RetryableOkfetchError) => boolean;
};

type LinearRetryOptions = {
  strategy: "linear";
  /** Maximum number of retry attempts. */
  attempts: number;
  /** Delay for the first retry in milliseconds. Defaults to 100. */
  initialDelay?: number;
  /** Amount added to the delay on each subsequent attempt in milliseconds. Defaults to 100. */
  step?: number;
  /** Maximum delay in milliseconds. No cap if omitted. */
  maxDelay?: number;
  /**
   * Optional callback to decide whether a given error should be retried.
   * If not provided, FetchError, TimeoutError, and ApiError with status >= 500
   * are retried by default.
   */
  shouldRetry?: (error: RetryableOkfetchError) => boolean;
};

type ExponentialRetryOptions = {
  strategy: "exponential";
  /** Maximum number of retry attempts. */
  attempts: number;
  /** Initial delay in milliseconds for the first retry. Defaults to 100. */
  initialDelay?: number;
  /** Multiplier applied to the delay on each subsequent attempt. Defaults to 2. */
  factor?: number;
  /** Maximum delay in milliseconds. No cap if omitted. */
  maxDelay?: number;
  /**
   * Optional callback to decide whether a given error should be retried.
   * If not provided, FetchError, TimeoutError, and ApiError with status >= 500
   * are retried by default.
   */
  shouldRetry?: (error: RetryableOkfetchError) => boolean;
};

/**
 * Retry strategies supported by `okfetch`.
 *
 * @category models
 * @since 0.3.1
 */
export type RetryOptions =
  | FixedRetryOptions
  | LinearRetryOptions
  | ExponentialRetryOptions;

/**
 * Request body values accepted by `okfetch` after normalization.
 *
 * @category models
 * @since 0.3.1
 */
export type OkfetchBody = Exclude<RequestInit["body"], undefined>;

/**
 * Override point for providing a custom `fetch` implementation.
 *
 * @category models
 * @since 0.3.1
 */
export type OkfetchFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

/** @internal */
export type StreamChunkValue<Options extends OkfetchOptions> =
  Options["outputSchema"] extends StandardSchemaV1
    ? StandardSchemaV1.InferOutput<Options["outputSchema"]>
    : unknown;

/**
 * Success payload returned by `okfetch`, including stream mode support.
 *
 * @category models
 * @since 0.3.1
 */
export type OkfetchSuccess<
  Options extends OkfetchOptions,
  TRes = StreamChunkValue<Options>,
> = Options["stream"] extends true ? ReadableStream<TRes> : TRes;

/**
 * Input received by a plugin `init` hook.
 *
 * @category plugins
 * @since 0.3.1
 */
export type OkfetchPluginInitInput = {
  url: string;
  options: OkfetchOptions;
};

/**
 * Mutable request state shared with plugin hooks.
 *
 * @category plugins
 * @since 0.3.1
 */
export type OkfetchRequestContext = Prettify<
  Omit<RequestInit, "body" | "headers" | "method" | "signal"> & {
    url: URL;
    method: Method | Uppercase<string>;
    headers: Headers;
    body?: OkfetchBody;
    signal: AbortSignal;
  }
>;

/**
 * Lifecycle hooks supported by an `okfetch` plugin.
 *
 * @category plugins
 * @since 0.3.1
 */
export type OkfetchPluginHooks<TData = unknown, TErr = unknown> = {
  onRequest?:
    | ((context: OkfetchRequestContext) => OkfetchRequestContext | undefined)
    | ((
        context: OkfetchRequestContext
      ) => Promise<OkfetchRequestContext | undefined>);
  onResponse?:
    | ((
        context: OkfetchRequestContext,
        response: Response
      ) => Response | undefined)
    | ((
        context: OkfetchRequestContext,
        response: Response
      ) => Promise<Response | undefined>);
  onSuccess?:
    | ((
        context: OkfetchRequestContext,
        response: Response,
        data: TData
      ) => void)
    | ((
        context: OkfetchRequestContext,
        response: Response,
        data: TData
      ) => Promise<void>);
  onFail?:
    | ((
        context: OkfetchRequestContext,
        response: Response | undefined,
        error: OkfetchError<TErr>
      ) => void)
    | ((
        context: OkfetchRequestContext,
        response: Response | undefined,
        error: OkfetchError<TErr>
      ) => Promise<void>);
  onRetry?:
    | ((
        context: OkfetchRequestContext,
        response: Response | undefined,
        error: RetryableOkfetchError,
        attempt: number
      ) => void)
    | ((
        context: OkfetchRequestContext,
        response: Response | undefined,
        error: RetryableOkfetchError,
        attempt: number
      ) => Promise<void>);
};

/**
 * Extension point for customizing request execution.
 *
 * @category plugins
 * @since 0.3.1
 */
export type OkfetchPlugin<TData = unknown, TErr = unknown> = {
  name: string;
  version: string;
  init?:
    | ((input: OkfetchPluginInitInput) => OkfetchPluginInitInput | undefined)
    | ((
        input: OkfetchPluginInitInput
      ) => Promise<OkfetchPluginInitInput | undefined>);
  hooks?: OkfetchPluginHooks<TData, TErr>;
};

/**
 * Request options accepted by `okfetch` in addition to standard `fetch` options.
 *
 * @category models
 * @since 0.3.1
 */
export type OkfetchOptions = Prettify<
  Omit<RequestInit, "body" | "headers"> & {
    method?: Method;
    headers?: Record<string, string>;
    auth?: Auth;
    outputSchema?: StandardSchemaV1;
    errorSchema?: StandardSchemaV1;
    apiErrorDataSchema?: StandardSchemaV1;
    baseURL?: string;
    params?: Record<string, string | number | boolean>;
    query?: Record<
      string,
      string | number | boolean | (string | number | boolean)[]
    >;
    body?: unknown;
    fetch?: OkfetchFetch;
    timeout?: number;
    stream?: boolean;
    validateOutput?: boolean;
    shouldValidateError?: (statusCode: number) => boolean;
    plugins?: OkfetchPlugin[];
    /** Retry configuration. Supports "fixed", "linear" and "exponential" backoff strategies. */
    retry?: RetryOptions;
    /** @internal */
    _retryAttempt?: number;
  }
>;
/** @ignore */
