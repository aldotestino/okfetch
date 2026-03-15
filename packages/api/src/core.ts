import type { KanonicOptions, KanonicPlugin } from "@kanonic/fetch";
import { ValidationError, kanonic } from "@kanonic/fetch";

import type {
  ApiClient,
  CreateApiOptions,
  EndpointCallOptions,
  EndpointDefinition,
  EndpointFunction,
  EndpointRequestOverrides,
  EndpointTree,
} from "./types";

const isEndpoint = (
  value: EndpointDefinition | EndpointTree
): value is EndpointDefinition =>
  typeof (value as EndpointDefinition).method === "string";

const createValidationPlugin = (
  endpoint: EndpointDefinition,
  enabled: boolean
): KanonicPlugin => ({
  name: "kanonic-endpoint-validator",
  version: "1.0.0",
  init: ({ options, url }) => {
    if (!enabled) {
      return { options, url };
    }

    if (endpoint.params) {
      const paramsResult = endpoint.params.safeParse(options.params ?? {});
      if (!paramsResult.success) {
        throw new ValidationError({
          type: "params",
          message: "Endpoint params did not match schema",
          zodError: paramsResult.error,
        });
      }
    }

    if (endpoint.query) {
      const queryResult = endpoint.query.safeParse(options.query ?? {});
      if (!queryResult.success) {
        throw new ValidationError({
          type: "query",
          message: "Endpoint query did not match schema",
          zodError: queryResult.error,
        });
      }
    }

    if (endpoint.body) {
      const bodyResult = endpoint.body.safeParse(options.body);
      if (!bodyResult.success) {
        throw new ValidationError({
          type: "body",
          message: "Endpoint body did not match schema",
          zodError: bodyResult.error,
        });
      }
    }

    return { options, url };
  },
});

const mergeHeaders = (
  ...headersList: (Record<string, string> | undefined)[]
): Record<string, string> | undefined => {
  const mergedHeaders = Object.assign({}, ...headersList);
  return Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined;
};

const buildEndpointFn = <TEndpoint extends EndpointDefinition, TGlobalError>(
  baseURL: string,
  endpoint: TEndpoint,
  globalDefaults: EndpointRequestOverrides,
  globalErrorSchema: CreateApiOptions<
    EndpointTree,
    TGlobalError
  >["errorSchema"],
  validateInput: boolean,
  validateOutput: boolean | undefined,
  shouldValidateError:
    | CreateApiOptions<EndpointTree, TGlobalError>["shouldValidateError"]
    | undefined
): EndpointFunction<TEndpoint, TGlobalError> => {
  const hasSchemaOptions =
    endpoint.body !== undefined ||
    endpoint.params !== undefined ||
    endpoint.query !== undefined;

  const endpointDefaults = endpoint.requestOptions ?? {};

  const fn = async (
    maybeCallOptions?:
      | EndpointCallOptions<TEndpoint>
      | EndpointRequestOverrides,
    maybeRequestOverrides?: EndpointRequestOverrides
  ) => {
    const callOptions = hasSchemaOptions
      ? (maybeCallOptions as EndpointCallOptions<TEndpoint> | undefined)
      : undefined;
    const requestOverrides = hasSchemaOptions
      ? maybeRequestOverrides
      : (maybeCallOptions as EndpointRequestOverrides | undefined);
    const payload = (callOptions ?? {}) as Partial<
      Pick<KanonicOptions, "body" | "params" | "query">
    >;

    const {
      headers: globalHeaders,
      plugins: globalPlugins,
      ...globalRest
    } = globalDefaults;
    const {
      headers: endpointHeaders,
      plugins: endpointPlugins,
      ...endpointRest
    } = endpointDefaults;
    const {
      headers: overrideHeaders,
      plugins: overridePlugins,
      ...overrideRest
    } = requestOverrides ?? {};

    const options: KanonicOptions = {
      ...globalRest,
      ...endpointRest,
      ...overrideRest,
      apiErrorDataSchema: endpoint.error ?? globalErrorSchema,
      baseURL,
      body: payload.body,
      headers: mergeHeaders(globalHeaders, endpointHeaders, overrideHeaders),
      method: endpoint.method,
      outputSchema: endpoint.output,
      params: payload.params,
      plugins: [
        createValidationPlugin(endpoint, validateInput),
        ...(globalPlugins ?? []),
        ...(endpointPlugins ?? []),
        ...(overridePlugins ?? []),
      ],
      query: payload.query,
      shouldValidateError,
      stream: endpoint.stream,
      validateOutput,
    };

    return kanonic(endpoint.path, options);
  };

  return fn as EndpointFunction<TEndpoint, TGlobalError>;
};

const buildClientNode = <TTree extends EndpointTree, TGlobalError>(
  tree: TTree,
  baseURL: string,
  globalDefaults: EndpointRequestOverrides,
  globalErrorSchema: CreateApiOptions<TTree, TGlobalError>["errorSchema"],
  validateInput: boolean,
  validateOutput: boolean | undefined,
  shouldValidateError:
    | CreateApiOptions<TTree, TGlobalError>["shouldValidateError"]
    | undefined
): ApiClient<TTree, TGlobalError> => {
  const node: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(tree)) {
    node[key] = isEndpoint(value)
      ? buildEndpointFn(
          baseURL,
          value,
          globalDefaults,
          globalErrorSchema,
          validateInput,
          validateOutput,
          shouldValidateError
        )
      : buildClientNode(
          value as EndpointTree,
          baseURL,
          globalDefaults,
          globalErrorSchema,
          validateInput,
          validateOutput,
          shouldValidateError
        );
  }

  return node as ApiClient<TTree, TGlobalError>;
};

export const createApi = <TTree extends EndpointTree, TGlobalError = unknown>({
  baseURL,
  endpoints,
  errorSchema,
  shouldValidateError,
  validateInput = true,
  validateOutput,
  ...globalDefaults
}: CreateApiOptions<TTree, TGlobalError>): ApiClient<TTree, TGlobalError> =>
  buildClientNode(
    endpoints,
    baseURL,
    globalDefaults as EndpointRequestOverrides,
    errorSchema,
    validateInput,
    validateOutput,
    shouldValidateError
  );

export const createEndpoints = <TTree extends EndpointTree>(endpoints: TTree) =>
  endpoints;

export const ApiService = <TTree extends EndpointTree, TGlobalError = unknown>(
  endpoints: TTree,
  errorSchema?: CreateApiOptions<TTree, TGlobalError>["errorSchema"]
) =>
  class ApiServiceClass {
    protected readonly client: ApiClient<TTree, TGlobalError>;

    constructor(
      options: Omit<
        CreateApiOptions<TTree, TGlobalError>,
        "endpoints" | "errorSchema"
      >
    ) {
      this.client = createApi({
        ...options,
        endpoints,
        errorSchema,
      });
    }

    get api(): ApiClient<TTree, TGlobalError> {
      return this.client;
    }
  };
