import { Result } from "better-result";
import type { z, ZodType } from "zod";

import { FetchError, ParseError } from "./errors";
import type { KanonicOptions } from "./types";

export const kanonic = async <
  TRes extends Options["outputSchema"] extends ZodType
    ? z.infer<Options["outputSchema"]>
    : unknown,
  Options extends KanonicOptions = KanonicOptions,
>(
  url: string,
  options: Options
): Promise<Result<TRes, FetchError | ParseError>> =>
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

    const data = yield* Result.await(
      Result.tryPromise({
        try: () => response.json(),
        catch: (error) =>
          new ParseError({
            message: "Failed to parse response as JSON",
            cause: error,
          }),
      })
    );

    return Result.ok(data as TRes);
  });
