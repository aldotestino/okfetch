import { Result } from "better-result";

import { FetchError, ParseError, TimeoutError } from "./errors";
import {
  runOnFail,
  runOnRequest,
  runOnResponse,
  runOnRetry,
  runOnSuccess,
  runPluginInit,
} from "./plugin-hooks";
import { buildRequestContext } from "./request-context";
import {
  createApiError,
  parseResponseData,
  readResponseText,
} from "./response";
import { computeRetryDelay, shouldRetryError, sleep } from "./retry";
import { createParsedStream } from "./stream";
import type {
  InferOutput,
  OkfetchError,
  OkfetchOptions,
  OkfetchRequestContext,
  OkfetchSuccess,
  RetryableOkfetchError,
  StandardSchemaV1,
} from "./types";

type RequestLoopState = {
  attempt: number;
  context: OkfetchRequestContext;
};

type ContinueLoop = {
  attempt: number;
  shouldContinue: true;
};

type StopLoop<TRes, TErr> = {
  result: Result<TRes, OkfetchError<TErr>>;
  shouldContinue: false;
};

type AttemptResult<TRes, TErr, Options extends OkfetchOptions> =
  | ContinueLoop
  | StopLoop<OkfetchSuccess<Options, TRes>, TErr>;

const withAttempt = (
  options: OkfetchOptions,
  attempt: number
): OkfetchOptions => ({
  ...options,
  _retryAttempt: attempt,
});

const shouldRetry = (
  error: RetryableOkfetchError,
  options: OkfetchOptions,
  attempt: number
): boolean => shouldRetryError(error, withAttempt(options, attempt));

const getRetryDelay = (options: OkfetchOptions, attempt: number): number =>
  computeRetryDelay(withAttempt(options, attempt), attempt);

const scheduleTimeout = (
  options: OkfetchOptions,
  controller: AbortController
): ReturnType<typeof setTimeout> | undefined => {
  if (options.signal || !options.timeout) {
    return undefined;
  }

  return setTimeout(() => {
    controller.abort();
  }, options.timeout);
};

const fetchResponse = async (
  context: OkfetchRequestContext,
  options: OkfetchOptions
) => {
  const controller = new AbortController();
  context.signal = options.signal ?? controller.signal;
  const timeout = scheduleTimeout(options, controller);
  const { url, ...fetchInit } = context;

  const result = await Result.tryPromise({
    catch: (error) => {
      if (
        error instanceof DOMException &&
        error.name === "AbortError" &&
        options.timeout
      ) {
        return new TimeoutError({
          cause: error,
          message: `Request timed out after ${options.timeout} ms`,
          timout: options.timeout,
        });
      }

      return new FetchError({
        cause: error,
        message: "Fetch request failed",
      });
    },
    try: () => (options.fetch ?? globalThis.fetch)(url, fetchInit),
  });

  if (timeout) {
    clearTimeout(timeout);
  }

  return result;
};

const retryRequest = async (
  plugins: NonNullable<OkfetchOptions["plugins"]>,
  context: OkfetchRequestContext,
  response: Response | undefined,
  error: RetryableOkfetchError,
  options: OkfetchOptions,
  attempt: number
): Promise<ContinueLoop> => {
  await runOnRetry(plugins, context, response, error, attempt);
  const delay = getRetryDelay(options, attempt);
  if (delay > 0) {
    await sleep(delay);
  }

  return {
    attempt: attempt + 1,
    shouldContinue: true,
  };
};

const failRequest = async <TErr>(
  plugins: NonNullable<OkfetchOptions["plugins"]>,
  context: OkfetchRequestContext,
  response: Response | undefined,
  error: OkfetchError<TErr>
): Promise<StopLoop<never, TErr>> => {
  await runOnFail(plugins, context, response, error);
  return {
    result: Result.err(error),
    shouldContinue: false,
  };
};

const readResponsePayload = async (response: Response, isStream: boolean) => {
  if (isStream && response.ok) {
    return Result.ok("");
  }

  return readResponseText(response);
};

const handleTransportError = async <TErr>(
  plugins: NonNullable<OkfetchOptions["plugins"]>,
  state: RequestLoopState,
  options: OkfetchOptions,
  error: RetryableOkfetchError
): Promise<ContinueLoop | StopLoop<never, TErr>> => {
  if (shouldRetry(error, options, state.attempt)) {
    return retryRequest(
      plugins,
      state.context,
      undefined,
      error,
      options,
      state.attempt
    );
  }

  return failRequest(
    plugins,
    state.context,
    undefined,
    error as OkfetchError<TErr>
  );
};

const handleApiFailure = async <TErr>(
  plugins: NonNullable<OkfetchOptions["plugins"]>,
  state: RequestLoopState,
  options: OkfetchOptions,
  response: Response,
  text: string
): Promise<ContinueLoop | StopLoop<never, TErr>> => {
  const apiError = await createApiError<TErr>(response, text, options);
  if (shouldRetry(apiError, options, state.attempt)) {
    return retryRequest(
      plugins,
      state.context,
      response,
      apiError,
      options,
      state.attempt
    );
  }

  return failRequest(plugins, state.context, response, apiError);
};

const handleSuccessfulResponse = async <
  TRes,
  TErr,
  Options extends OkfetchOptions,
>(
  plugins: NonNullable<OkfetchOptions["plugins"]>,
  context: OkfetchRequestContext,
  options: Options,
  response: Response,
  text: string
): Promise<Result<OkfetchSuccess<Options, TRes>, OkfetchError<TErr>>> => {
  if (options.stream) {
    if (!response.body) {
      const parseError = new ParseError({
        message: "Response body is null",
      });
      await runOnFail(plugins, context, response, parseError);
      return Result.err(parseError);
    }

    const stream = createParsedStream<TRes>(
      response.body as ReadableStream<Uint8Array>,
      options.outputSchema,
      options.validateOutput ?? true
    );
    await runOnSuccess(
      plugins,
      context,
      response,
      stream as OkfetchSuccess<Options, TRes>
    );
    return Result.ok(stream as OkfetchSuccess<Options, TRes>);
  }

  const dataResult = await parseResponseData<OkfetchSuccess<Options, TRes>>(
    text,
    options
  );
  if (dataResult.isErr()) {
    await runOnFail(plugins, context, response, dataResult.error);
    return Result.err(dataResult.error);
  }

  await runOnSuccess(plugins, context, response, dataResult.value);
  return Result.ok(dataResult.value);
};

const executeAttempt = async <TRes, TErr, Options extends OkfetchOptions>(
  plugins: NonNullable<OkfetchOptions["plugins"]>,
  state: RequestLoopState,
  options: Options
): Promise<AttemptResult<TRes, TErr, Options>> => {
  const requestResult = await runOnRequest(plugins, { ...state.context });
  if (requestResult.isErr()) {
    return {
      result: Result.err(requestResult.error as OkfetchError<TErr>),
      shouldContinue: false,
    };
  }

  state.context = requestResult.value;
  const responseResult = await fetchResponse(state.context, options);
  if (responseResult.isErr()) {
    return handleTransportError<TErr>(
      plugins,
      state,
      options,
      responseResult.error
    );
  }

  const hookResponseResult = await runOnResponse(
    plugins,
    state.context,
    responseResult.value
  );
  if (hookResponseResult.isErr()) {
    return {
      result: Result.err(hookResponseResult.error as OkfetchError<TErr>),
      shouldContinue: false,
    };
  }

  const response = hookResponseResult.value;
  const textResult = await readResponsePayload(
    response,
    options.stream === true
  );
  if (textResult.isErr()) {
    return {
      result: Result.err(textResult.error),
      shouldContinue: false,
    };
  }

  if (!response.ok) {
    return handleApiFailure<TErr>(
      plugins,
      state,
      options,
      response,
      textResult.value
    );
  }

  return {
    result: await handleSuccessfulResponse<TRes, TErr, Options>(
      plugins,
      state.context,
      options,
      response,
      textResult.value
    ),
    shouldContinue: false,
  };
};

export function okfetch<
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
  TApiErrorSchema extends StandardSchemaV1 | undefined = undefined,
>(
  url: string,
  options?: OkfetchOptions & {
    apiErrorDataSchema?: TApiErrorSchema;
    outputSchema?: TOutputSchema;
    stream?: false;
  }
): Promise<
  Result<
    TOutputSchema extends StandardSchemaV1
      ? InferOutput<TOutputSchema>
      : unknown,
    OkfetchError<
      TApiErrorSchema extends StandardSchemaV1
        ? InferOutput<TApiErrorSchema>
        : unknown
    >
  >
>;
export function okfetch<
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
  TApiErrorSchema extends StandardSchemaV1 | undefined = undefined,
>(
  url: string,
  options: OkfetchOptions & {
    apiErrorDataSchema?: TApiErrorSchema;
    outputSchema?: TOutputSchema;
    stream: true;
  }
): Promise<
  Result<
    ReadableStream<
      TOutputSchema extends StandardSchemaV1
        ? InferOutput<TOutputSchema>
        : unknown
    >,
    OkfetchError<
      TApiErrorSchema extends StandardSchemaV1
        ? InferOutput<TApiErrorSchema>
        : unknown
    >
  >
>;
export function okfetch<TRes = unknown>(
  url: string,
  options: OkfetchOptions & { stream: true }
): Promise<Result<ReadableStream<TRes>, OkfetchError<unknown>>>;
export function okfetch<TRes = unknown, TErr = unknown>(
  url: string,
  options: OkfetchOptions & { stream: true }
): Promise<Result<ReadableStream<TRes>, OkfetchError<TErr>>>;
export function okfetch<TRes = unknown, TErr = unknown>(
  url: string,
  options?: OkfetchOptions
): Promise<Result<TRes, OkfetchError<TErr>>>;
export async function okfetch<TRes = unknown, TErr = unknown>(
  url: string,
  options?: OkfetchOptions
): Promise<Result<TRes, OkfetchError<TErr>>> {
  const resolvedInputOptions = options ?? {};
  const plugins = resolvedInputOptions.plugins ?? [];
  const initResult = await runPluginInit(plugins, {
    options: resolvedInputOptions,
    url,
  });
  if (initResult.isErr()) {
    return Result.err(initResult.error as OkfetchError<TErr>);
  }

  const requestContext = buildRequestContext(
    initResult.value.url,
    initResult.value.options
  );
  const resolvedOptions = initResult.value.options;
  const state: RequestLoopState = {
    attempt: resolvedOptions._retryAttempt ?? 0,
    context: requestContext,
  };

  while (true) {
    const outcome = await executeAttempt<TRes, TErr, OkfetchOptions>(
      plugins,
      state,
      resolvedOptions
    );
    if (outcome.shouldContinue) {
      state.attempt = outcome.attempt;
      continue;
    }

    return outcome.result;
  }
}
