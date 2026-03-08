import { TaggedError } from "better-result";
import type { ZodError } from "zod";

export class FetchError extends TaggedError("FetchError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {}

export class ParseError extends TaggedError("ParseError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {}

export class ValidationError extends TaggedError("ValidationError")<{
  readonly type: "output" | "error" | "query" | "params" | "body";
  readonly message: string;
  readonly zodError: ZodError;
}>() {}

export class ApiError<T = unknown> extends TaggedError("ApiError")<{
  readonly statusCode: number;
  readonly statusText: string;
  readonly text?: string;
  readonly data?: unknown;
}>() {
  declare readonly data: T | undefined;
}
