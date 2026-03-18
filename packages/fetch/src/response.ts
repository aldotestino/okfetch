import { Result } from "better-result";

import { ApiError, ParseError, ValidationError } from "./errors";
import { validateSchema } from "./schema";
import type { OkfetchOptions } from "./types";

export const shouldValidateErrorResponse = (
  options: OkfetchOptions,
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

export const createApiError = async <TErr>(
  response: Response,
  text: string,
  options: OkfetchOptions
): Promise<ApiError<TErr>> => {
  const errorDataSchema = options.apiErrorDataSchema;
  const baseError = new ApiError<TErr>({
    statusCode: response.status,
    statusText: response.statusText,
    text,
  });

  if (
    errorDataSchema === undefined ||
    !shouldValidateErrorResponse(options, response.status)
  ) {
    return baseError;
  }

  const apiErrorDataResult = Result.try({
    catch: (error) => error,
    try: () => JSON.parse(text),
  });
  if (apiErrorDataResult.isErr()) {
    return baseError;
  }

  const parsedApiErrorData = await validateSchema(
    errorDataSchema,
    apiErrorDataResult.value
  );
  if (!parsedApiErrorData.success) {
    return baseError;
  }

  return new ApiError<TErr>({
    data: parsedApiErrorData.data as TErr,
    statusCode: response.status,
    statusText: response.statusText,
    text,
  });
};

export const parseResponseData = async <TRes>(
  text: string,
  options: OkfetchOptions
): Promise<Result<TRes, ParseError | ValidationError>> => {
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

  const parsedData = await validateSchema(
    options.outputSchema,
    dataResult.value
  );
  if (!parsedData.success) {
    return Result.err(
      new ValidationError({
        issues: parsedData.issues,
        message: "Response body did not match output schema",
        type: "output",
      })
    );
  }

  return Result.ok(parsedData.data as TRes);
};
