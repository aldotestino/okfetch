/**
 * Public types for `@okfetch/api`.
 *
 * @since 0.3.1
 */
import type { OkfetchError, OkfetchOptions } from "@okfetch/fetch";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Result } from "better-result";

type InferInput<TSchema extends StandardSchemaV1> =
  StandardSchemaV1.InferInput<TSchema>;

type InferOutput<TSchema extends StandardSchemaV1> =
  StandardSchemaV1.InferOutput<TSchema>;

/**
 * Request options that can be overridden per generated endpoint call.
 *
 * @category models
 * @since 0.3.1
 */
export type EndpointRequestOverrides = Omit<
  OkfetchOptions,
  | "_retryAttempt"
  | "apiErrorDataSchema"
  | "baseURL"
  | "body"
  | "errorSchema"
  | "method"
  | "outputSchema"
  | "params"
  | "query"
  | "stream"
>;

/**
 * Schema-driven description of a single API endpoint.
 *
 * @category models
 * @since 0.3.1
 */
export type EndpointDefinition = {
  method: NonNullable<OkfetchOptions["method"]>;
  path: `/${string}`;
  body?: StandardSchemaV1;
  error?: StandardSchemaV1;
  output?: StandardSchemaV1;
  params?: StandardSchemaV1;
  query?: StandardSchemaV1;
  requestOptions?: EndpointRequestOverrides;
  stream?: true;
};

/**
 * Recursive tree of endpoint groups and endpoint definitions.
 *
 * @category models
 * @since 0.3.1
 */
export type EndpointTree = {
  [key: string]: EndpointDefinition | EndpointTree;
};

/**
 * Input object expected by a generated endpoint method.
 *
 * @category models
 * @since 0.3.1
 */
export type EndpointCallOptions<TEndpoint extends EndpointDefinition> =
  Prettify<
    (TEndpoint["body"] extends StandardSchemaV1
      ? { body: InferInput<TEndpoint["body"]> }
      : {}) &
      (TEndpoint["params"] extends StandardSchemaV1
        ? { params: InferInput<TEndpoint["params"]> }
        : {}) &
      (TEndpoint["query"] extends StandardSchemaV1
        ? { query: InferInput<TEndpoint["query"]> }
        : {})
  >;

/** @internal */
export type EndpointOutput<TEndpoint extends EndpointDefinition> =
  TEndpoint["output"] extends StandardSchemaV1
    ? InferOutput<TEndpoint["output"]>
    : unknown;

/** @internal */
export type EndpointError<
  TEndpoint extends EndpointDefinition,
  TGlobalError,
> = TEndpoint["error"] extends StandardSchemaV1
  ? InferOutput<TEndpoint["error"]>
  : TGlobalError;

/** @internal */
export type EndpointSuccess<TEndpoint extends EndpointDefinition> =
  TEndpoint["stream"] extends true
    ? ReadableStream<
        TEndpoint["output"] extends StandardSchemaV1
          ? InferOutput<TEndpoint["output"]>
          : string
      >
    : EndpointOutput<TEndpoint>;

/** @internal */
export type EndpointResult<
  TEndpoint extends EndpointDefinition,
  TGlobalError,
> = Promise<
  Result<
    EndpointSuccess<TEndpoint>,
    OkfetchError<EndpointError<TEndpoint, TGlobalError>>
  >
>;

/** @internal */
export type ZeroOptionEndpointFunction<
  TEndpoint extends EndpointDefinition,
  TGlobalError,
> = (
  requestOverrides?: EndpointRequestOverrides
) => EndpointResult<TEndpoint, TGlobalError>;

/** @internal */
export type OptionEndpointFunction<
  TEndpoint extends EndpointDefinition,
  TGlobalError,
> = (
  options: EndpointCallOptions<TEndpoint>,
  requestOverrides?: EndpointRequestOverrides
) => EndpointResult<TEndpoint, TGlobalError>;

/**
 * Function type generated for a single endpoint definition.
 *
 * @category models
 * @since 0.3.1
 */
export type EndpointFunction<
  TEndpoint extends EndpointDefinition,
  TGlobalError,
> = keyof EndpointCallOptions<TEndpoint> extends never
  ? ZeroOptionEndpointFunction<TEndpoint, TGlobalError>
  : OptionEndpointFunction<TEndpoint, TGlobalError>;

/**
 * Fully generated API client shape produced from an endpoint tree.
 *
 * @category models
 * @since 0.3.1
 */
export type ApiClient<TTree extends EndpointTree, TGlobalError = unknown> = {
  [TKey in keyof TTree]: TTree[TKey] extends EndpointDefinition
    ? EndpointFunction<TTree[TKey], TGlobalError>
    : TTree[TKey] extends EndpointTree
      ? ApiClient<TTree[TKey], TGlobalError>
      : never;
};

/**
 * Options accepted by {@link createApi}.
 *
 * @category models
 * @since 0.3.1
 */
export type CreateApiOptions<
  TTree extends EndpointTree,
  TGlobalError = unknown,
> = Prettify<
  EndpointRequestOverrides & {
    baseURL: string;
    endpoints: TTree;
    errorSchema?: StandardSchemaV1<unknown, TGlobalError>;
    shouldValidateError?: (statusCode: number) => boolean;
    validateInput?: boolean;
    validateOutput?: boolean;
  }
>;

/**
 * Constructor type returned by {@link ApiService}.
 *
 * @category models
 * @since 0.3.1
 */
export type ApiServiceClass<
  TTree extends EndpointTree,
  TGlobalError = unknown,
> = new (
  options: Omit<
    CreateApiOptions<TTree, TGlobalError>,
    "endpoints" | "errorSchema"
  >
) => {
  readonly api: ApiClient<TTree, TGlobalError>;
};

/** @internal */
type Prettify<TValue> = {
  [TKey in keyof TValue]: TValue[TKey];
} & {};
