import { TaggedError } from "better-result";

export class FetchError extends TaggedError("FetchError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {}

export class ParseError extends TaggedError("ParseError")<{
  readonly message: string;
  readonly cause?: unknown;
}>() {}
