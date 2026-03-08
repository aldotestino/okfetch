// oxlint-disable max-statements
import { Result } from "better-result";
import type { z, ZodType } from "zod/v4";

import {
  ApiError,
  FetchError,
  ParseError,
  TimeoutError,
  ValidationError,
} from "./errors";
import type { KanonicOptions } from "./types";

const nonBodyMethods = new Set(["HEAD", "OPTIONS"]);

type KanonicError<TErr> =
  | FetchError
  | ApiError<TErr>
  | ParseError
  | ValidationError
  | TimeoutError;

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
): Promise<Result<TRes, KanonicError<TErr>>> =>
  Result.gen(async function* () {
    // prepare the url with url and baseURL, params and query (if provided)
    // params must replace the same keys in the url identified by firstpart/:key/scondpart
    let _url: URL;

    let urlWithParams = url;
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        urlWithParams = urlWithParams.replace(
          new RegExp(`:${key}(?=/|$)`), // match :key followed by / or end of string
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
      _url = new URL(normalizedPath, normalizedBase);
    } else {
      _url = new URL(urlWithParams);
    }

    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            _url.searchParams.append(key, String(item));
          }
        } else {
          _url.searchParams.append(key, String(value));
        }
      }
    }

    const headers = new Headers(options.headers);

    if (options.auth) {
      switch (options.auth.type) {
        case "basic": {
          const { username, password } = options.auth;
          const credentials = btoa(`${username}:${password}`);
          headers.set("Authorization", `Basic ${credentials}`);
          break;
        }
        case "bearer": {
          const { token } = options.auth;
          headers.set("Authorization", `Bearer ${token}`);
          break;
        }
        default: {
          const { prefix, value } = options.auth;
          headers.set("Authorization", `${prefix} ${value}`);
          break;
        }
      }
    }

    const method = options.method || (options.body ? "POST" : "GET");

    let body;

    if (nonBodyMethods.has(method) || !options.body) {
      body = undefined;
    } else if (
      headers.has("Content-Type") &&
      headers.get("Content-Type")?.includes("x-www-form-urlencoded")
    ) {
      body = new URLSearchParams(options.body).toString();
    } else {
      body = JSON.stringify(options.body);
    }

    const controller = new AbortController();
    const signal = options.signal ?? controller.signal;

    const context = {
      ...options,
      headers,
      method,
      body,
      signal,
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (!options.signal && options.timeout) {
      timeout = setTimeout(() => {
        controller.abort();
      }, options.timeout);
    }

    const responseResult = await Result.tryPromise({
      try: () => fetch(_url, context),
      catch: (error) => {
        if (
          error instanceof DOMException &&
          error.name === "AbortError" &&
          options.timeout
        ) {
          // if is an AbortError and a timeout was set, we can assume it was caused by the timeout
          return new TimeoutError({
            timout: options.timeout,
            message: `Request timed out after ${options.timeout} ms`,
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
      return Result.err(responseResult.error);
    }

    const response = responseResult.value;

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
    "https://jsonplaceholder.typicode.co/todos/2",
    {
      // outputSchema: z.object({
      //   id: z.number(),
      // }),
      // apiErrorDataSchema: z.object({
      //   message: z.string(),
      // }),
      timeout: 1,
    }
  )
).match({
  ok: (data) => data.id,
  err: (error) => {
    if (error._tag === "ApiError") {
      console.error(`Api Error: ${error.data?.message}`);
    } else {
      console.error(
        `Error: ${error._tag}, Message: ${error.message}, Cause: ${error.cause}`
      );
    }
    // return -1 in case of error for demonstration purposes
    return -1;
  },
});

console.log("Todo ID:", _todoId);
