import type {
  InferInput,
  InferOutput,
  OkfetchError,
  OkfetchOptions,
  StandardSchemaV1,
} from "@okfetch/fetch";
import type { Result } from "better-result";

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

export type EndpointTree = {
  [key: string]: EndpointDefinition | EndpointTree;
};

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

export type EndpointOutput<TEndpoint extends EndpointDefinition> =
  TEndpoint["output"] extends StandardSchemaV1
    ? InferOutput<TEndpoint["output"]>
    : unknown;

export type EndpointError<
  TEndpoint extends EndpointDefinition,
  TGlobalError,
> = TEndpoint["error"] extends StandardSchemaV1
  ? InferOutput<TEndpoint["error"]>
  : TGlobalError;

export type EndpointSuccess<TEndpoint extends EndpointDefinition> =
  TEndpoint["stream"] extends true
    ? ReadableStream<
        TEndpoint["output"] extends StandardSchemaV1
          ? InferOutput<TEndpoint["output"]>
          : string
      >
    : EndpointOutput<TEndpoint>;

export type EndpointResult<
  TEndpoint extends EndpointDefinition,
  TGlobalError,
> = Promise<
  Result<
    EndpointSuccess<TEndpoint>,
    OkfetchError<EndpointError<TEndpoint, TGlobalError>>
  >
>;

export type ZeroOptionEndpointFunction<
  TEndpoint extends EndpointDefinition,
  TGlobalError,
> = (
  requestOverrides?: EndpointRequestOverrides
) => EndpointResult<TEndpoint, TGlobalError>;

export type OptionEndpointFunction<
  TEndpoint extends EndpointDefinition,
  TGlobalError,
> = (
  options: EndpointCallOptions<TEndpoint>,
  requestOverrides?: EndpointRequestOverrides
) => EndpointResult<TEndpoint, TGlobalError>;

export type EndpointFunction<
  TEndpoint extends EndpointDefinition,
  TGlobalError,
> = keyof EndpointCallOptions<TEndpoint> extends never
  ? ZeroOptionEndpointFunction<TEndpoint, TGlobalError>
  : OptionEndpointFunction<TEndpoint, TGlobalError>;

export type ApiClient<TTree extends EndpointTree, TGlobalError = unknown> = {
  [TKey in keyof TTree]: TTree[TKey] extends EndpointDefinition
    ? EndpointFunction<TTree[TKey], TGlobalError>
    : TTree[TKey] extends EndpointTree
      ? ApiClient<TTree[TKey], TGlobalError>
      : never;
};

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

type Prettify<TValue> = {
  [TKey in keyof TValue]: TValue[TKey];
} & {};
