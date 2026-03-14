// oxlint-disable import/no-relative-parent-imports
import type { Result } from "better-result";
import type { infer as Infer, ZodType } from "zod/v4";

import type { KanonicError, KanonicOptions } from "../types";

export type EndpointRequestOverrides = Omit<
  KanonicOptions,
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
  method: NonNullable<KanonicOptions["method"]>;
  path: `/${string}`;
  body?: ZodType;
  error?: ZodType;
  output?: ZodType;
  params?: ZodType;
  query?: ZodType;
  requestOptions?: EndpointRequestOverrides;
  stream?: true;
};

export type EndpointTree = {
  [key: string]: EndpointDefinition | EndpointTree;
};

export type EndpointCallOptions<TEndpoint extends EndpointDefinition> =
  Prettify<
    (TEndpoint["body"] extends ZodType
      ? { body: Infer<TEndpoint["body"]> }
      : {}) &
      (TEndpoint["params"] extends ZodType
        ? { params: Infer<TEndpoint["params"]> }
        : {}) &
      (TEndpoint["query"] extends ZodType
        ? { query: Infer<TEndpoint["query"]> }
        : {})
  >;

export type EndpointOutput<TEndpoint extends EndpointDefinition> =
  TEndpoint["output"] extends ZodType ? Infer<TEndpoint["output"]> : unknown;

export type EndpointError<
  TEndpoint extends EndpointDefinition,
  TGlobalError,
> = TEndpoint["error"] extends ZodType
  ? Infer<TEndpoint["error"]>
  : TGlobalError;

export type ApiErrors<TError = unknown> = KanonicError<TError>;

export type EndpointSuccess<TEndpoint extends EndpointDefinition> =
  TEndpoint["stream"] extends true
    ? ReadableStream<
        TEndpoint["output"] extends ZodType
          ? Infer<TEndpoint["output"]>
          : string
      >
    : EndpointOutput<TEndpoint>;

export type EndpointResult<
  TEndpoint extends EndpointDefinition,
  TGlobalError,
> = Promise<
  Result<
    EndpointSuccess<TEndpoint>,
    ApiErrors<EndpointError<TEndpoint, TGlobalError>>
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
    errorSchema?: ZodType<TGlobalError>;
    shouldValidateError?: (statusCode: number) => boolean;
    validateInput?: boolean;
    validateOutput?: boolean;
  }
>;

export type IsEndpoint<TValue> = TValue extends { method: string }
  ? true
  : false;

type Prettify<TValue> = {
  [TKey in keyof TValue]: TValue[TKey];
} & {};
