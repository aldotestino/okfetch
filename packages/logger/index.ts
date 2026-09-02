import type { OkfetchPlugin } from "@okfetch/fetch";
import pino from "pino";

export type Logger = {
  error(message: string): void;
  info(message: string): void;
  warn(message: string): void;
};

export type LoggerOptions = {
  logDataOnSuccess?: boolean;
} & (
  | {
      logger: Logger;
      pinoOptions?: never;
    }
  | {
      logger?: never;
      pinoOptions?: pino.LoggerOptions;
    }
);

export const logger = (options?: LoggerOptions): OkfetchPlugin => {
  const logWriter = options?.logger ?? pino(options?.pinoOptions);

  return {
    name: "logger",
    version: "1.0.0",
    hooks: {
      async onRequest(ctx) {
        logWriter.info(`Sending request to [${ctx.method}] ${ctx.url}`);
        return ctx;
      },
      async onSuccess(_, response, data) {
        if (options?.logDataOnSuccess) {
          logWriter.info(
            `Request succeeded with status ${response.status} and data: ${JSON.stringify(
              data
            )}`
          );
        } else {
          logWriter.info(`Request succeeded with status ${response.status}`);
        }
      },
      async onFail(_ctx, _response, error) {
        logWriter.error(`Request failed [${error._tag}] ${error.message}`);
      },
      async onRetry(_ctx, _response, error, attempt) {
        logWriter.warn(
          `Request failed [${error._tag}], retrying attempt ${attempt + 1}...`
        );
      },
    },
  } satisfies OkfetchPlugin;
};
