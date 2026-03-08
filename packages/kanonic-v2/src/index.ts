import { Result } from "better-result";
import type { z, ZodType } from "zod/v4";

import { ApiError, FetchError, ParseError, ValidationError } from "./errors";
import type { KanonicOptions } from "./types";

export const kanonic = async <
  TRes extends Options["outputSchema"] extends ZodType
    ? z.infer<Options["outputSchema"]>
    : unknown,
  TErr extends Options["apiErrorDataSchema"] extends ZodType
    ? z.infer<Options["apiErrorDataSchema"]>
    : unknown,
  Options extends KanonicOptions = KanonicOptions,
>(
  url: string,
  options: Options
): Promise<
  Result<TRes, FetchError | ApiError<TErr> | ParseError | ValidationError>
> =>
  Result.gen(async function* () {
    const response = yield* Result.await(
      Result.tryPromise({
        try: () => fetch(url, options),
        catch: (error) =>
          new FetchError({
            message: "Fetch request failed",
            cause: error,
          }),
      })
    );

    const text = yield* Result.await(
      Result.tryPromise({
        try: () => response.text(),
        catch: (error) =>
          new ParseError({
            message: "Failed to read response body as text",
            cause: error,
          }),
      })
    );

    if (!response.ok) {
      // try to parse the body as JSON to extract error details, but ignore parsing errors.
      const apiErrorData = Result.try(() => JSON.parse(text)).unwrapOr({});

      if (options.apiErrorDataSchema) {
        const {
          success,
          error,
          data: parsedApiErrorData,
        } = options.apiErrorDataSchema.safeParse(apiErrorData);

        if (!success) {
          return Result.err(
            new ValidationError({
              message: "Failed to parse API error data with provided schema",
              type: "error",
              zodError: error,
            })
          );
        }

        return Result.err(
          new ApiError<TErr>({
            statusCode: response.status,
            statusText: response.statusText,
            text,
            data: parsedApiErrorData as TErr,
          })
        );
      }

      return Result.err(
        new ApiError<TErr>({
          statusCode: response.status,
          statusText: response.statusText,
          text,
        })
      );
    }

    const data = yield* Result.try({
      try: () => JSON.parse(text),
      catch: (error) =>
        new ParseError({
          message: "Failed to parse response body as JSON",
          cause: error,
        }),
    });

    if (options.outputSchema) {
      const {
        success,
        data: parsedData,
        error,
      } = options.outputSchema.safeParse(data);

      if (!success) {
        return Result.err(
          new ValidationError({
            type: "output",
            message: "Response body did not match output schema",
            zodError: error,
          })
        );
      }

      return Result.ok(parsedData as TRes);
    }

    return Result.ok(data as TRes);
  });

// oxlint-disable-next-line unicorn/no-await-expression-member
const _todoId = (
  await kanonic<{ id: number }, { message: string }>(
    "https://jsonplaceholder.typicode.com/todos/1",
    {
      // outputSchema: z.object({
      //   id: z.number(),
      // }),
      // apiErrorDataSchema: z.object({
      //   message: z.string(),
      // }),
    }
  )
).match({
  ok: (data) => data.id,
  err: (error) => {
    if (error._tag === "ApiError") {
      console.error(`Api Error: ${error.data?.message}`);
    } else {
      console.error(`Error: ${error.message}`);
    }
    // return -1 in case of error for demonstration purposes
    return -1;
  },
});
