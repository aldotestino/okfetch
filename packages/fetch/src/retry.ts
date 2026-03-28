/**
 * Internal retry policy helpers.
 *
 * @internal
 * @since 0.3.1
 */
import type { OkfetchOptions, RetryableOkfetchError } from "./types";

/** @internal */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** @internal */
export const computeRetryDelay = (
  options: OkfetchOptions,
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
    const rawDelay =
      (retry.initialDelay ?? 100) + (retry.step ?? 100) * attempt;
    return retry.maxDelay === undefined
      ? rawDelay
      : Math.min(rawDelay, retry.maxDelay);
  }

  const rawDelay = (retry.initialDelay ?? 100) * (retry.factor ?? 2) ** attempt;
  return retry.maxDelay === undefined
    ? rawDelay
    : Math.min(rawDelay, retry.maxDelay);
};

/** @internal */
const isRetryableByDefault = (error: RetryableOkfetchError): boolean =>
  error._tag === "FetchError" ||
  error._tag === "TimeoutError" ||
  (error._tag === "ApiError" && error.statusCode >= 500);

/** @internal */
export const shouldRetryError = (
  error: RetryableOkfetchError,
  options: OkfetchOptions
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
