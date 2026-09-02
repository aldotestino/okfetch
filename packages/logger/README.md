# @okfetch/logger

`@okfetch/logger` is a small `pino`-powered plugin for okfetch request lifecycles.

It gives you a ready-made `OkfetchPlugin` that logs:

- outbound requests
- successful responses
- failures
- retries

Use it when you want sensible request logging without writing your own plugin from scratch.

## Installation

```bash
bun add @okfetch/logger @okfetch/fetch pino
```

```bash
npm install @okfetch/logger @okfetch/fetch pino
```

## Usage

```ts
import { okfetch } from "@okfetch/fetch";
import { logger } from "@okfetch/logger";
import pino from "pino";

const pinoInstance = pino({
  level: "info",
  redact: ["req.headers.authorization"],
});

const result = await okfetch("https://example.com/health", {
  plugins: [
    logger({
      logDataOnSuccess: true,
      logger: pinoInstance,
    }),
  ],
});
```

## API

`logger(options?)`

Options:

- `logDataOnSuccess?: boolean`
- `logger?: Logger`
- `pinoOptions?: pino.LoggerOptions`

When `logDataOnSuccess` is `true`, the plugin logs the parsed success payload in addition to the response status.

Pass `logger` to use any logger with `info`, `warn`, and `error` methods that accept a message string. This includes existing Pino instances and compatible loggers from other libraries. `logger` and `pinoOptions` are mutually exclusive. When no logger is provided, the plugin creates a Pino instance using `pinoOptions`.

## What It Logs

Hook coverage:

- `onRequest`
- `onSuccess`
- `onFail`
- `onRetry`

Example log flow:

- request started
- request succeeded with status
- or request failed with tagged error
- or request is being retried

## Relationship To `@okfetch/fetch`

This package is just a plugin built on top of the public `OkfetchPlugin` interface from `@okfetch/fetch`.

If you need custom log formatting, request correlation, redaction, or tracing metadata, you can use this package as-is or as a starting point for your own plugin.
