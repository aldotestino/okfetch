import { Result } from "better-result";
import type { infer as Infer, ZodType } from "zod/v4";

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
  KanonicError,
  KanonicOptions,
  KanonicRequestContext,
  KanonicSuccess,
  RetryableKanonicError,
} from "./types";

type RequestLoopState = {
  attempt: number;
  context: KanonicRequestContext;
};

type ContinueLoop = {
  attempt: number;
  shouldContinue: true;
};

type StopLoop<TRes, TErr> = {
  result: Result<TRes, KanonicError<TErr>>;
  shouldContinue: false;
};

type AttemptResult<TRes, TErr, Options extends KanonicOptions> =
  | ContinueLoop
  | StopLoop<KanonicSuccess<Options, TRes>, TErr>;

const withAttempt = (
  options: KanonicOptions,
  attempt: number
): KanonicOptions => ({
  ...options,
  _retryAttempt: attempt,
});

const shouldRetry = (
  error: RetryableKanonicError,
  options: KanonicOptions,
  attempt: number
): boolean => shouldRetryError(error, withAttempt(options, attempt));

const getRetryDelay = (options: KanonicOptions, attempt: number): number =>
  computeRetryDelay(withAttempt(options, attempt), attempt);

const scheduleTimeout = (
  options: KanonicOptions,
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
  context: KanonicRequestContext,
  options: KanonicOptions
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
  plugins: NonNullable<KanonicOptions["plugins"]>,
  context: KanonicRequestContext,
  response: Response | undefined,
  error: RetryableKanonicError,
  options: KanonicOptions,
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
  plugins: NonNullable<KanonicOptions["plugins"]>,
  context: KanonicRequestContext,
  response: Response | undefined,
  error: KanonicError<TErr>
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
  plugins: NonNullable<KanonicOptions["plugins"]>,
  state: RequestLoopState,
  options: KanonicOptions,
  error: RetryableKanonicError
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
    error as KanonicError<TErr>
  );
};

const handleApiFailure = async <TErr>(
  plugins: NonNullable<KanonicOptions["plugins"]>,
  state: RequestLoopState,
  options: KanonicOptions,
  response: Response,
  text: string
): Promise<ContinueLoop | StopLoop<never, TErr>> => {
  const apiError = createApiError<TErr>(response, text, options);
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
  Options extends KanonicOptions,
>(
  plugins: NonNullable<KanonicOptions["plugins"]>,
  context: KanonicRequestContext,
  options: Options,
  response: Response,
  text: string
): Promise<Result<KanonicSuccess<Options, TRes>, KanonicError<TErr>>> => {
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
      stream as KanonicSuccess<Options, TRes>
    );
    return Result.ok(stream as KanonicSuccess<Options, TRes>);
  }

  const dataResult = parseResponseData<KanonicSuccess<Options, TRes>>(
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

const executeAttempt = async <TRes, TErr, Options extends KanonicOptions>(
  plugins: NonNullable<KanonicOptions["plugins"]>,
  state: RequestLoopState,
  options: Options
): Promise<AttemptResult<TRes, TErr, Options>> => {
  const requestResult = await runOnRequest(plugins, { ...state.context });
  if (requestResult.isErr()) {
    return {
      result: Result.err(requestResult.error as KanonicError<TErr>),
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
      result: Result.err(hookResponseResult.error as KanonicError<TErr>),
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
    options: options as KanonicOptions,
    url,
  });
  if (initResult.isErr()) {
    return Result.err(initResult.error as KanonicError<TErr>);
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
    const outcome = await executeAttempt<TRes, TErr, Options>(
      plugins,
      state,
      resolvedOptions as Options
    );
    if (outcome.shouldContinue) {
      state.attempt = outcome.attempt;
      continue;
    }

    return outcome.result;
  }
}
