import type { ZodType } from "zod";

import type {
  ApiError,
  FetchError,
  ParseError,
  TimeoutError,
  ValidationError,
} from "./errors";
import type { Prettify } from "./type-utils";

export type KanonicError<TErr> =
  | FetchError
  | ApiError<TErr>
  | ParseError
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
      string | number | boolean | Array<string | number | boolean>
    >;
    // oxlint-disable-next-line typescript/no-explicit-any
    body?: any;
    timeout?: number;
    asStream?: boolean;
    /** Retry configuration. Supports "fixed", "linear" and "exponential" backoff strategies. */
    retry?: RetryOptions;
    /** @internal */
    _retryAttempt?: number;
  }
>;
