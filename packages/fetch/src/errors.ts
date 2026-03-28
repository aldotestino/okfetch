/**
 * Tagged error classes returned by `@okfetch/fetch`.
 *
 * @since 0.3.1
 */
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { TaggedError } from "better-result";

/**
 * Raised when the underlying `fetch` call fails before an HTTP response is received.
 *
 * @category errors
 * @since 0.3.1
 */
export class FetchError extends TaggedError("FetchError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {}

/**
 * Raised when a response or stream chunk cannot be parsed into the expected shape.
 *
 * @category errors
 * @since 0.3.1
 */
export class ParseError extends TaggedError("ParseError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {}

/**
 * Raised when request input, response output, or structured API error data fails schema validation.
 *
 * @category errors
 * @since 0.3.1
 */
export class ValidationError extends TaggedError("ValidationError")<{
  readonly type: "output" | "error" | "query" | "params" | "body";
  readonly message: string;
  readonly issues: readonly StandardSchemaV1.Issue[];
}>() {}

/**
 * Raised when the server responds with a non-2xx status code.
 *
 * @category errors
 * @since 0.3.1
 */
export class ApiError<T = unknown> extends TaggedError("ApiError")<{
  readonly statusCode: number;
  readonly statusText: string;
  readonly text?: string;
  readonly data?: unknown;
}>() {
  /**
   * Parsed error payload validated against `apiErrorDataSchema`, when available.
   *
   * @category errors
   * @since 0.3.1
   */
  declare readonly data: T | undefined;
}

/**
 * Raised when a request exceeds the configured timeout.
 *
 * @category errors
 * @since 0.3.1
 */
export class TimeoutError extends TaggedError("TimeoutError")<{
  readonly timout: number;
  readonly message: string;
  readonly cause?: unknown;
}>() {}

/**
 * Raised when a plugin throws during `init`, `onRequest`, or `onResponse`.
 *
 * @category errors
 * @since 0.3.1
 */
export class PluginError extends TaggedError("PluginError")<{
  readonly pluginName: string;
  readonly hook: "init" | "onRequest" | "onResponse";
  readonly message: string;
  readonly cause?: unknown;
}>() {}
