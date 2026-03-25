import type { StandardSchemaV1 } from "@standard-schema/spec";

export {
  ApiError,
  FetchError,
  ParseError,
  PluginError,
  TimeoutError,
  ValidationError,
} from "./errors";
export type {
  Auth,
  InferInput,
  InferOutput,
  OkfetchError,
  OkfetchFetch,
  OkfetchOptions,
  OkfetchPlugin,
  OkfetchPluginHooks,
  OkfetchSuccess,
  Method,
  RetryOptions,
} from "./types";
export type { StandardSchemaV1 } from "@standard-schema/spec";
export type StandardSchemaIssue = StandardSchemaV1.Issue;
export { validateAllErrors, validateClientErrors } from "./presets";
export { validateSchema } from "./schema";
export { okfetch } from "./okfetch";
