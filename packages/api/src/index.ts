/**
 * Public entrypoint for `@okfetch/api`.
 *
 * @internal
 * @since 0.3.1
 */
export { ApiService, createApi, createEndpoints } from "./core";
export type { OkfetchError } from "@okfetch/fetch";

export type {
  ApiClient,
  ApiServiceClass,
  CreateApiOptions,
  EndpointDefinition as Endpoint,
  EndpointCallOptions,
  EndpointFunction,
  EndpointRequestOverrides,
  EndpointTree,
} from "./types";
