import type { KanonicPlugin } from "@kanonic/fetch";
import pino from "pino";

type LoggerOptions = {
  pinoOptions: pino.LoggerOptions;
  logDataOnSuccess?: boolean;
};

export const logger = (options: LoggerOptions) => {
  const pinoLogger = pino(options.pinoOptions);

  return {
    name: "logger",
    version: "1.0.0",
    hooks: {
      async onRequest(ctx) {
        pinoLogger.info(`Sending request to [${ctx.method}] ${ctx.url}`);
        return ctx;
      },
      async onSuccess(_, response, data) {
        if (options.logDataOnSuccess) {
          pinoLogger.info(
            `Request succeeded with status ${response.status} and data: ${JSON.stringify(
              data
            )}`
          );
        } else {
          pinoLogger.info(`Request succeeded with status ${response.status}`);
        }
      },
      async onFail(_ctx, _response, error) {
        pinoLogger.error(`Request failed [${error._tag}] ${error.message}`);
      },
      async onRetry(_ctx, _response, error, attempt) {
        pinoLogger.warn(
          `Request failed [${error._tag}], retrying attempt ${attempt + 1}...`
        );
      },
    },
  } satisfies KanonicPlugin;
};
