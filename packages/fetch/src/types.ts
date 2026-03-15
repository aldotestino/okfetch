import type { infer as Infer, ZodType } from "zod/v4";

import type {
  ApiError,
  FetchError,
  ParseError,
  PluginError,
  TimeoutError,
  ValidationError,
} from "./errors";
import type { Prettify } from "./type-utils";

export type KanonicError<TErr> =
  | FetchError
  | ApiError<TErr>
  | ParseError
  | PluginError
  | ValidationError
  | TimeoutError;

export type RetryableKanonicError =
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

export type Auth = BasicAuth | BearerAuth | CustomAuth;

export type NonBodyMethods = "HEAD" | "OPTIONS";
export type BodyMethods = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
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
  shouldRetry?: (error: RetryableKanonicError) => boolean;
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
  shouldRetry?: (error: RetryableKanonicError) => boolean;
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
  shouldRetry?: (error: RetryableKanonicError) => boolean;
};

export type RetryOptions =
  | FixedRetryOptions
  | LinearRetryOptions
  | ExponentialRetryOptions;

export type KanonicBody = Exclude<RequestInit["body"], undefined>;
export type KanonicFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type StreamChunkValue<Options extends KanonicOptions> =
  Options["outputSchema"] extends ZodType
    ? Infer<Options["outputSchema"]>
    : unknown;

export type KanonicSuccess<
  Options extends KanonicOptions,
  TRes = StreamChunkValue<Options>,
> = Options["stream"] extends true ? ReadableStream<TRes> : TRes;

export type KanonicPluginInitInput = {
  url: string;
  options: KanonicOptions;
};

export type KanonicRequestContext = Prettify<
  Omit<RequestInit, "body" | "headers" | "method" | "signal"> & {
    url: URL;
    method: Method | Uppercase<string>;
    headers: Headers;
    body?: KanonicBody;
    signal: AbortSignal;
  }
>;

export type KanonicPluginHooks<TData = unknown, TErr = unknown> = {
  onRequest?:
    | ((context: KanonicRequestContext) => KanonicRequestContext | undefined)
    | ((
        context: KanonicRequestContext
      ) => Promise<KanonicRequestContext | undefined>);
  onResponse?:
    | ((
        context: KanonicRequestContext,
        response: Response
      ) => Response | undefined)
    | ((
        context: KanonicRequestContext,
        response: Response
      ) => Promise<Response | undefined>);
  onSuccess?:
    | ((
        context: KanonicRequestContext,
        response: Response,
        data: TData
      ) => void)
    | ((
        context: KanonicRequestContext,
        response: Response,
        data: TData
      ) => Promise<void>);
  onFail?:
    | ((
        context: KanonicRequestContext,
        response: Response | undefined,
        error: KanonicError<TErr>
      ) => void)
    | ((
        context: KanonicRequestContext,
        response: Response | undefined,
        error: KanonicError<TErr>
      ) => Promise<void>);
  onRetry?:
    | ((
        context: KanonicRequestContext,
        response: Response | undefined,
        error: RetryableKanonicError,
        attempt: number
      ) => void)
    | ((
        context: KanonicRequestContext,
        response: Response | undefined,
        error: RetryableKanonicError,
        attempt: number
      ) => Promise<void>);
};

export type KanonicPlugin<TData = unknown, TErr = unknown> = {
  name: string;
  version: string;
  init?:
    | ((input: KanonicPluginInitInput) => KanonicPluginInitInput | undefined)
    | ((
        input: KanonicPluginInitInput
      ) => Promise<KanonicPluginInitInput | undefined>);
  hooks?: KanonicPluginHooks<TData, TErr>;
};

export type KanonicOptions = Prettify<
  Omit<RequestInit, "body" | "headers"> & {
    method?: Method;
    headers?: Record<string, string>;
    auth?: Auth;
    outputSchema?: ZodType;
    errorSchema?: ZodType;
    apiErrorDataSchema?: ZodType;
    baseURL?: string;
    params?: Record<string, string | number | boolean>;
    query?: Record<
      string,
      string | number | boolean | (string | number | boolean)[]
    >;
    body?: unknown;
    fetch?: KanonicFetch;
    timeout?: number;
    stream?: boolean;
    validateOutput?: boolean;
    shouldValidateError?: (statusCode: number) => boolean;
    plugins?: KanonicPlugin[];
    /** Retry configuration. Supports "fixed", "linear" and "exponential" backoff strategies. */
    retry?: RetryOptions;
    /** @internal */
    _retryAttempt?: number;
  }
>;
