import { Result } from "better-result";

import { ApiError, ParseError, ValidationError } from "./errors";
import type { KanonicOptions } from "./types";

export const shouldValidateErrorResponse = (
  options: KanonicOptions,
  statusCode: number
): boolean =>
  options.apiErrorDataSchema !== undefined &&
  (options.shouldValidateError?.(statusCode) ?? false);

export const readResponseText = async (
  response: Response
): Promise<Result<string, ParseError>> =>
  Result.tryPromise({
    catch: (error) =>
      new ParseError({
        cause: error,
        message: "Failed to read response body as text",
      }),
    try: () => response.text(),
  });

export const createApiError = <TErr>(
  response: Response,
  text: string,
  options: KanonicOptions
): ApiError<TErr> => {
  const baseError = new ApiError<TErr>({
    statusCode: response.status,
    statusText: response.statusText,
    text,
  });

  if (!shouldValidateErrorResponse(options, response.status)) {
    return baseError;
  }

  const apiErrorDataResult = Result.try({
    catch: (error) => error,
    try: () => JSON.parse(text),
  });
  if (apiErrorDataResult.isErr()) {
    return baseError;
  }

  const parsedApiErrorData = options.apiErrorDataSchema?.safeParse(
    apiErrorDataResult.value
  );
  if (!parsedApiErrorData?.success) {
    return baseError;
  }

  return new ApiError<TErr>({
    data: parsedApiErrorData.data as TErr,
    statusCode: response.status,
    statusText: response.statusText,
    text,
  });
};

export const parseResponseData = <TRes>(
  text: string,
  options: KanonicOptions
): Result<TRes, ParseError | ValidationError> => {
  const dataResult = Result.try({
    catch: (error) =>
      new ParseError({
        cause: error,
        message: "Failed to parse response body as JSON",
      }),
    try: () => JSON.parse(text),
  });
  if (dataResult.isErr()) {
    return dataResult;
  }

  if (!options.outputSchema || options.validateOutput === false) {
    return Result.ok(dataResult.value as TRes);
  }

  const parsedData = options.outputSchema.safeParse(dataResult.value);
  if (!parsedData.success) {
    return Result.err(
      new ValidationError({
        message: "Response body did not match output schema",
        type: "output",
        zodError: parsedData.error,
      })
    );
  }

  return Result.ok(parsedData.data as TRes);
};
