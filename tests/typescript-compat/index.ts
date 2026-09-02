import { createApi, createEndpoints } from "@okfetch/api";
import { okfetch, type OkfetchOptions } from "@okfetch/fetch";
import { logger, type LoggerOptions } from "@okfetch/logger";
import { otel, type OtelOptions } from "@okfetch/otel";

const options: OkfetchOptions = {
  plugins: [logger()],
};

const endpoints = createEndpoints({
  health: {
    method: "GET",
    path: "/health",
  },
});

createApi({ baseURL: "https://example.com", endpoints });
void okfetch("https://example.com", options);

const loggerOptions: LoggerOptions = { logDataOnSuccess: true };
logger(loggerOptions);

const otelOptions: OtelOptions = { captureRequestHeaders: false };
otel(otelOptions);
