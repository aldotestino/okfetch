import { Result } from "better-result";

import {
  ApiError,
  FetchError,
  ParseError,
  PluginError,
  TimeoutError,
  ValidationError,
} from "./errors";
import type {
  KanonicError,
  KanonicPlugin,
  KanonicPluginInitInput,
  KanonicRequestContext,
  RetryableKanonicError,
} from "./types";

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
    cause: error,
    hook,
    message: `Plugin "${pluginName}" failed during ${hook}`,
    pluginName,
  });
};

export const runPluginInit = async (
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

export const runOnRequest = async (
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

export const runOnResponse = async (
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

export const runOnSuccess = async <TRes>(
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
      // Side-effect hook errors must not fail the request.
    }
  }
};

export const runOnFail = async <TErr>(
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
      // Side-effect hook errors must not mask the original failure.
    }
  }
};

export const runOnRetry = async (
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
      // Side-effect hook errors must not block retries.
    }
  }
};
