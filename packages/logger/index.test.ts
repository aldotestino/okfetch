import { describe, expect, test } from "bun:test";

import type { OkfetchPluginHooks } from "@okfetch/fetch";

import { logger } from "./index";
import type { Logger, LoggerOptions } from "./index";

type RequestContext = Parameters<
  NonNullable<OkfetchPluginHooks["onRequest"]>
>[0];

const requestContext: RequestContext = {
  body: undefined,
  headers: new Headers(),
  method: "GET",
  signal: new AbortController().signal,
  url: new URL("https://example.com/health"),
};

describe("logger", () => {
  test("uses a provided logger", async () => {
    const messages: string[] = [];
    const customLogger: Logger = {
      error: (message) => messages.push(`error: ${message}`),
      info: (message) => messages.push(`info: ${message}`),
      warn: (message) => messages.push(`warn: ${message}`),
    };
    const plugin = logger({ logger: customLogger });

    await plugin.hooks?.onRequest?.(requestContext);

    expect(messages).toEqual([
      "info: Sending request to [GET] https://example.com/health",
    ]);
  });

  test("does not allow pino options with a provided logger", () => {
    const messages: string[] = [];
    const customLogger: Logger = {
      error: (message) => messages.push(message),
      info: (message) => messages.push(message),
      warn: (message) => messages.push(message),
    };

    // @ts-expect-error A provided logger and Pino options are exclusive.
    const options: LoggerOptions = { logger: customLogger, pinoOptions: {} };

    expect(options).toBeDefined();
  });
});
