// oxlint-disable max-statements
// oxlint-disable complexity
import { Result } from "better-result";
import type { infer as Infer, ZodType } from "zod/v4";

import {
  ApiError,
  FetchError,
  ParseError,
  PluginError,
  TimeoutError,
  ValidationError,
} from "./errors";
import type {
  KanonicBody,
  KanonicError,
  KanonicOptions,
  KanonicPlugin,
  KanonicPluginInitInput,
  KanonicRequestContext,
  KanonicSuccess,
  RetryableKanonicError,
} from "./types";

export {
  ApiError,
  FetchError,
  ParseError,
  PluginError,
  TimeoutError,
  ValidationError,
} from "./errors";
export type {
  KanonicBody,
  KanonicError,
  KanonicFetch,
  KanonicOptions,
  KanonicPlugin,
  KanonicPluginHooks,
  KanonicPluginInitInput,
  KanonicRequestContext,
  KanonicSuccess,
  RetryOptions,
} from "./types";
export { ApiService, createApi, createEndpoints } from "./client";
export type {
  ApiErrors,
  ApiClient,
  CreateApiOptions,
  Endpoint,
  EndpointCallOptions,
  EndpointFunction,
  EndpointRequestOverrides,
  EndpointTree,
} from "./client";

const nonBodyMethods = new Set(["HEAD", "OPTIONS"]);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const extractDataLine = (line: string): string | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return null;
  }

  const dataContent = trimmed.slice(5).trim();
  if (!dataContent || dataContent === "[DONE]") {
    return null;
  }

  return dataContent;
};

const processStreamChunk = (
  dataContent: string,
  outputSchema?: ZodType
): Result<unknown, ParseError | ValidationError> => {
  if (!outputSchema) {
    return Result.ok(dataContent);
  }

  const parsedJson = Result.try({
    try: () => JSON.parse(dataContent),
    catch: (error) =>
      new ParseError({
        message: "Failed to parse stream chunk as JSON",
        cause: error,
      }),
  });
  if (parsedJson.isErr()) {
    return parsedJson;
  }

  const parsedChunk = outputSchema.safeParse(parsedJson.value);
  if (!parsedChunk.success) {
    return Result.err(
      new ValidationError({
        type: "output",
        message: "Stream chunk did not match output schema",
        zodError: parsedChunk.error,
      })
    );
  }

  return Result.ok(parsedChunk.data);
};

const createParsedStream = <TRes>(
  responseBody: ReadableStream<Uint8Array>,
  outputSchema?: ZodType
): ReadableStream<TRes> => {
  const reader = responseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream<TRes>({
    async cancel() {
      await reader.cancel();
    },
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (buffer.trim()) {
            const lines = buffer.split("\n");
            for (const line of lines) {
              const dataContent = extractDataLine(line);
              if (dataContent === null) {
                continue;
              }

              const parsedChunk = processStreamChunk(dataContent, outputSchema);
              if (parsedChunk.isErr()) {
                controller.error(parsedChunk.error);
                return;
              }

              controller.enqueue(parsedChunk.value as TRes);
            }
          }

          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const dataContent = extractDataLine(line);
          if (dataContent === null) {
            continue;
          }

          const parsedChunk = processStreamChunk(dataContent, outputSchema);
          if (parsedChunk.isErr()) {
            controller.error(parsedChunk.error);
            return;
          }

          controller.enqueue(parsedChunk.value as TRes);
          return;
        }
      }
    },
  });
};

const isKanonicError = <TErr>(error: unknown): error is KanonicError<TErr> =>
  error instanceof FetchError ||
  error instanceof ApiError ||
  error instanceof ParseError ||
  error instanceof PluginError ||
  error instanceof TimeoutError ||
  error instanceof ValidationError;

const wrapPluginError = <TErr>(
  error: unknown,
  pluginName: string,
  hook: "init" | "onRequest" | "onResponse"
): KanonicError<TErr> => {
  if (isKanonicError<TErr>(error)) {
    return error;
  }

  return new PluginError({
    pluginName,
    hook,
    message: `Plugin "${pluginName}" failed during ${hook}`,
    cause: error,
  });
};

const runPluginInit = async (
  plugins: KanonicPlugin[],
  input: KanonicPluginInitInput
): Promise<Result<KanonicPluginInitInput, KanonicError<unknown>>> => {
  let current = input;

  for (const plugin of plugins) {
    if (!plugin.init) {
      continue;
    }

    try {
      const next = await plugin.init(current);
      if (next) {
        current = next;
      }
    } catch (error) {
      return Result.err(wrapPluginError(error, plugin.name, "init"));
    }
  }

  return Result.ok(current);
};

const runOnRequest = async (
  plugins: KanonicPlugin[],
  context: KanonicRequestContext
): Promise<Result<KanonicRequestContext, KanonicError<unknown>>> => {
  let current = context;

  for (const plugin of plugins) {
    if (!plugin.hooks?.onRequest) {
      continue;
    }

    try {
      const next = await plugin.hooks.onRequest(current);
      if (next) {
        current = next;
      }
    } catch (error) {
      return Result.err(wrapPluginError(error, plugin.name, "onRequest"));
    }
  }

  return Result.ok(current);
};

const runOnResponse = async (
  plugins: KanonicPlugin[],
  context: KanonicRequestContext,
  response: Response
): Promise<Result<Response, KanonicError<unknown>>> => {
  let current = response;

  for (const plugin of plugins) {
    if (!plugin.hooks?.onResponse) {
      continue;
    }

    try {
      const next = await plugin.hooks.onResponse(context, current);
      if (next) {
        current = next;
      }
    } catch (error) {
      return Result.err(wrapPluginError(error, plugin.name, "onResponse"));
    }
  }

  return Result.ok(current);
};

const runOnSuccess = async <TRes>(
  plugins: KanonicPlugin[],
  context: KanonicRequestContext,
  response: Response,
  data: TRes
): Promise<void> => {
  for (const plugin of plugins) {
    if (!plugin.hooks?.onSuccess) {
      continue;
    }

    try {
      await plugin.hooks.onSuccess(context, response, data);
    } catch {
      // Swallow side-effect hook failures.
    }
  }
};

const runOnFail = async <TErr>(
  plugins: KanonicPlugin[],
  context: KanonicRequestContext,
  response: Response | undefined,
  error: KanonicError<TErr>
): Promise<void> => {
  for (const plugin of plugins) {
    if (!plugin.hooks?.onFail) {
      continue;
    }

    try {
      await plugin.hooks.onFail(context, response, error);
    } catch {
      // Swallow side-effect hook failures.
    }
  }
};

const runOnRetry = async (
  plugins: KanonicPlugin[],
  context: KanonicRequestContext,
  response: Response | undefined,
  error: RetryableKanonicError,
  attempt: number
): Promise<void> => {
  for (const plugin of plugins) {
    if (!plugin.hooks?.onRetry) {
      continue;
    }

    try {
      await plugin.hooks.onRetry(context, response, error, attempt);
    } catch {
      // Swallow side-effect hook failures.
    }
  }
};

const buildRequestContext = (
  url: string,
  options: KanonicOptions
): KanonicRequestContext => {
  let resolvedUrl: URL;

  let urlWithParams = url;
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      urlWithParams = urlWithParams.replace(
        new RegExp(`:${key}(?=[/?]|$)`),
        encodeURIComponent(String(value))
      );
    }
  }

  if (options.baseURL) {
    const normalizedBase = options.baseURL.endsWith("/")
      ? options.baseURL
      : `${options.baseURL}/`;
    const normalizedPath = urlWithParams.startsWith("/")
      ? urlWithParams.slice(1)
      : urlWithParams;
    resolvedUrl = new URL(normalizedPath, normalizedBase);
  } else {
    resolvedUrl = new URL(urlWithParams);
  }

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          resolvedUrl.searchParams.append(key, String(item));
        }
      } else {
        resolvedUrl.searchParams.append(key, String(value));
      }
    }
  }

  const headers = new Headers(options.headers);

  if (options.auth) {
    switch (options.auth.type) {
      case "basic": {
        const credentials = btoa(
          `${options.auth.username}:${options.auth.password}`
        );
        headers.set("Authorization", `Basic ${credentials}`);
        break;
      }
      case "bearer": {
        headers.set("Authorization", `Bearer ${options.auth.token}`);
        break;
      }
      default: {
        headers.set(
          "Authorization",
          `${options.auth.prefix} ${options.auth.value}`
        );
      }
    }
  }

  const method = options.method || (options.body ? "POST" : "GET");

  let body: KanonicBody | undefined;
  if (nonBodyMethods.has(method) || !options.body) {
    body = undefined;
  } else if (
    headers.has("Content-Type") &&
    headers.get("Content-Type")?.includes("x-www-form-urlencoded")
  ) {
    body = new URLSearchParams(
      options.body as Record<string, string | readonly string[]>
    ).toString();
  } else if (
    options.body instanceof FormData ||
    options.body instanceof URLSearchParams ||
    options.body instanceof Blob ||
    typeof options.body === "string" ||
    options.body instanceof ArrayBuffer ||
    ArrayBuffer.isView(options.body) ||
    options.body instanceof ReadableStream
  ) {
    body = options.body as KanonicBody;
  } else {
    body = JSON.stringify(options.body);
  }

  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  const {
    apiErrorDataSchema: _apiErrorDataSchema,
    auth: _auth,
    baseURL: _baseURL,
    body: _rawBody,
    errorSchema: _errorSchema,
    fetch: _fetch,
    headers: _headers,
    method: _method,
    outputSchema: _outputSchema,
    params: _params,
    plugins: _plugins,
    query: _query,
    retry: _retry,
    stream: _stream,
    timeout: _timeout,
    _retryAttempt,
    ...requestInit
  } = options;

  return {
    ...requestInit,
    url: resolvedUrl,
    headers,
    method,
    body,
    signal,
  };
};

const computeRetryDelay = (
  options: KanonicOptions,
  attempt: number
): number => {
  const { retry } = options;
  if (!retry) {
    return 0;
  }

  if (retry.strategy === "fixed") {
    return retry.delay ?? 0;
  }

  if (retry.strategy === "linear") {
    const raw = (retry.initialDelay ?? 100) + (retry.step ?? 100) * attempt;
    return retry.maxDelay === undefined ? raw : Math.min(raw, retry.maxDelay);
  }

  // exponential
  const raw = (retry.initialDelay ?? 100) * (retry.factor ?? 2) ** attempt;
  return retry.maxDelay === undefined ? raw : Math.min(raw, retry.maxDelay);
};

const isRetryableByDefault = (error: RetryableKanonicError): boolean =>
  error._tag === "FetchError" ||
  error._tag === "TimeoutError" ||
  (error._tag === "ApiError" && error.statusCode >= 500);

const shouldRetryError = (
  error: RetryableKanonicError,
  options: KanonicOptions
): boolean => {
  const { retry } = options;
  if (!retry) {
    return false;
  }

  const attempt = options._retryAttempt ?? 0;
  if (attempt >= retry.attempts) {
    return false;
  }

  return retry.shouldRetry
    ? retry.shouldRetry(error)
    : isRetryableByDefault(error);
};

export function kanonic<Options extends KanonicOptions = KanonicOptions>(
  url: string,
  options: Options
): Promise<
  Result<
    KanonicSuccess<
      Options,
      Options["outputSchema"] extends ZodType
        ? Infer<Options["outputSchema"]>
        : unknown
    >,
    KanonicError<
      Options["apiErrorDataSchema"] extends ZodType
        ? Infer<Options["apiErrorDataSchema"]>
        : unknown
    >
  >
>;
export function kanonic<TRes = unknown>(
  url: string,
  options: KanonicOptions & { stream: true }
): Promise<Result<ReadableStream<TRes>, KanonicError<unknown>>>;
export function kanonic<TRes = unknown, TErr = unknown>(
  url: string,
  options: KanonicOptions & { stream: true }
): Promise<Result<ReadableStream<TRes>, KanonicError<TErr>>>;
export function kanonic<TRes = unknown, TErr = unknown>(
  url: string,
  options: KanonicOptions
): Promise<Result<TRes, KanonicError<TErr>>>;
export async function kanonic<
  TRes = unknown,
  TErr = unknown,
  Options extends KanonicOptions = KanonicOptions,
>(
  url: string,
  options: Options
): Promise<Result<KanonicSuccess<Options, TRes>, KanonicError<TErr>>> {
  const plugins = options.plugins ?? [];
  const initResult = await runPluginInit(plugins, {
    url,
    options: options as KanonicOptions,
  });

  if (initResult.isErr()) {
    return Result.err(initResult.error as KanonicError<TErr>);
  }

  const resolvedUrl = initResult.value.url;
  const resolvedOptions = initResult.value.options;
  const requestContext = buildRequestContext(resolvedUrl, resolvedOptions);
  const fetchImplementation = resolvedOptions.fetch ?? globalThis.fetch;
  const retryOptions = resolvedOptions.retry;
  let attempt = resolvedOptions._retryAttempt ?? 0;

  while (true) {
    const requestResult = await runOnRequest(plugins, { ...requestContext });
    if (requestResult.isErr()) {
      await runOnFail(
        plugins,
        requestContext,
        undefined,
        requestResult.error as KanonicError<TErr>
      );
      return Result.err(requestResult.error as KanonicError<TErr>);
    }

    const currentContext = requestResult.value;
    const controller = new AbortController();
    const signal = resolvedOptions.signal ?? controller.signal;
    currentContext.signal = signal;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (!resolvedOptions.signal && resolvedOptions.timeout) {
      timeout = setTimeout(() => {
        controller.abort();
      }, resolvedOptions.timeout);
    }

    const { url: currentUrl, ...fetchInit } = currentContext;
    const responseResult = await Result.tryPromise({
      try: () => fetchImplementation(currentUrl, fetchInit),
      catch: (error) => {
        if (
          error instanceof DOMException &&
          error.name === "AbortError" &&
          resolvedOptions.timeout
        ) {
          return new TimeoutError({
            timout: resolvedOptions.timeout,
            message: `Request timed out after ${resolvedOptions.timeout} ms`,
            cause: error,
          });
        }

        return new FetchError({
          message: "Fetch request failed",
          cause: error,
        });
      },
    });

    if (timeout) {
      clearTimeout(timeout);
    }

    if (responseResult.isErr()) {
      const { error } = responseResult;
      if (
        retryOptions &&
        shouldRetryError(error, {
          ...resolvedOptions,
          _retryAttempt: attempt,
        })
      ) {
        await runOnRetry(plugins, currentContext, undefined, error, attempt);
        const delay = computeRetryDelay(
          { ...resolvedOptions, _retryAttempt: attempt },
          attempt
        );
        if (delay > 0) {
          await sleep(delay);
        }
        attempt += 1;
        continue;
      }

      await runOnFail(
        plugins,
        currentContext,
        undefined,
        error as KanonicError<TErr>
      );
      return Result.err(error as KanonicError<TErr>);
    }

    const hookResponseResult = await runOnResponse(
      plugins,
      currentContext,
      responseResult.value
    );
    if (hookResponseResult.isErr()) {
      await runOnFail(
        plugins,
        currentContext,
        responseResult.value,
        hookResponseResult.error as KanonicError<TErr>
      );
      return Result.err(hookResponseResult.error as KanonicError<TErr>);
    }

    const response = hookResponseResult.value;

    if (resolvedOptions.stream) {
      if (!response.ok) {
        const textResult = await Result.tryPromise({
          try: () => response.text(),
          catch: (error) =>
            new ParseError({
              message: "Failed to read response body as text",
              cause: error,
            }),
        });
        if (textResult.isErr()) {
          await runOnFail(plugins, currentContext, response, textResult.error);
          return Result.err(textResult.error);
        }

        const text = textResult.value;
        const apiErrorData = Result.try(() => JSON.parse(text)).unwrapOr({});

        let apiError: ApiError<TErr>;
        if (resolvedOptions.apiErrorDataSchema) {
          const parsedApiErrorData =
            resolvedOptions.apiErrorDataSchema.safeParse(apiErrorData);

          if (!parsedApiErrorData.success) {
            const validationError = new ValidationError({
              message: "Failed to parse API error data with provided schema",
              type: "error",
              zodError: parsedApiErrorData.error,
            });
            await runOnFail(plugins, currentContext, response, validationError);
            return Result.err(validationError);
          }

          apiError = new ApiError<TErr>({
            statusCode: response.status,
            statusText: response.statusText,
            text,
            data: parsedApiErrorData.data as TErr,
          });
        } else {
          apiError = new ApiError<TErr>({
            statusCode: response.status,
            statusText: response.statusText,
            text,
          });
        }

        if (
          retryOptions &&
          shouldRetryError(apiError, {
            ...resolvedOptions,
            _retryAttempt: attempt,
          })
        ) {
          await runOnRetry(
            plugins,
            currentContext,
            response,
            apiError,
            attempt
          );
          const delay = computeRetryDelay(
            { ...resolvedOptions, _retryAttempt: attempt },
            attempt
          );
          if (delay > 0) {
            await sleep(delay);
          }
          attempt += 1;
          continue;
        }

        await runOnFail(plugins, currentContext, response, apiError);
        return Result.err(apiError);
      }

      if (!response.body) {
        const parseError = new ParseError({
          message: "Response body is null",
        });
        await runOnFail(plugins, currentContext, response, parseError);
        return Result.err(parseError);
      }

      const stream = createParsedStream<TRes>(
        response.body as ReadableStream<Uint8Array>,
        resolvedOptions.outputSchema
      );
      await runOnSuccess(
        plugins,
        currentContext,
        response,
        stream as KanonicSuccess<Options, TRes>
      );
      return Result.ok(stream as KanonicSuccess<Options, TRes>);
    }

    const textResult = await Result.tryPromise({
      try: () => response.text(),
      catch: (error) =>
        new ParseError({
          message: "Failed to read response body as text",
          cause: error,
        }),
    });
    if (textResult.isErr()) {
      await runOnFail(plugins, currentContext, response, textResult.error);
      return Result.err(textResult.error);
    }
    const text = textResult.value;

    if (!response.ok) {
      const apiErrorData = Result.try(() => JSON.parse(text)).unwrapOr({});

      let apiError: ApiError<TErr>;
      if (resolvedOptions.apiErrorDataSchema) {
        const parsedApiErrorData =
          resolvedOptions.apiErrorDataSchema.safeParse(apiErrorData);

        if (!parsedApiErrorData.success) {
          const validationError = new ValidationError({
            message: "Failed to parse API error data with provided schema",
            type: "error",
            zodError: parsedApiErrorData.error,
          });
          await runOnFail(
            plugins,
            currentContext,
            response,
            validationError as KanonicError<TErr>
          );
          return Result.err(validationError);
        }

        apiError = new ApiError<TErr>({
          statusCode: response.status,
          statusText: response.statusText,
          text,
          data: parsedApiErrorData.data as TErr,
        });
      } else {
        apiError = new ApiError<TErr>({
          statusCode: response.status,
          statusText: response.statusText,
          text,
        });
      }

      if (
        retryOptions &&
        shouldRetryError(apiError, {
          ...resolvedOptions,
          _retryAttempt: attempt,
        })
      ) {
        await runOnRetry(plugins, currentContext, response, apiError, attempt);
        const delay = computeRetryDelay(
          { ...resolvedOptions, _retryAttempt: attempt },
          attempt
        );
        if (delay > 0) {
          await sleep(delay);
        }
        attempt += 1;
        continue;
      }

      await runOnFail(plugins, currentContext, response, apiError);
      return Result.err(apiError);
    }

    const dataResult = Result.try({
      try: () => JSON.parse(text),
      catch: (error) =>
        new ParseError({
          message: "Failed to parse response body as JSON",
          cause: error,
        }),
    });
    if (dataResult.isErr()) {
      await runOnFail(plugins, currentContext, response, dataResult.error);
      return Result.err(dataResult.error);
    }
    const data = dataResult.value;

    if (resolvedOptions.outputSchema) {
      const parsedData = resolvedOptions.outputSchema.safeParse(data);

      if (!parsedData.success) {
        const validationError = new ValidationError({
          type: "output",
          message: "Response body did not match output schema",
          zodError: parsedData.error,
        });
        await runOnFail(plugins, currentContext, response, validationError);
        return Result.err(validationError);
      }

      await runOnSuccess(
        plugins,
        currentContext,
        response,
        parsedData.data as KanonicSuccess<Options, TRes>
      );
      return Result.ok(parsedData.data as KanonicSuccess<Options, TRes>);
    }

    await runOnSuccess(
      plugins,
      currentContext,
      response,
      data as KanonicSuccess<Options, TRes>
    );
    return Result.ok(data as KanonicSuccess<Options, TRes>);
  }
}
