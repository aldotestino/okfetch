# @kanonic/logger

`@kanonic/logger` is a small `pino`-powered plugin for kanonic request lifecycles.

It gives you a ready-made `KanonicPlugin` that logs:

- outbound requests
- successful responses
- failures
- retries

Use it when you want sensible request logging without writing your own plugin from scratch.

## Installation

```bash
bun add @kanonic/logger @kanonic/fetch pino
```

```bash
npm install @kanonic/logger @kanonic/fetch pino
```

## Usage

```ts
import { kanonic } from "@kanonic/fetch";
import { logger } from "@kanonic/logger";

const result = await kanonic("https://example.com/health", {
  plugins: [
    logger({
      logDataOnSuccess: true,
    }),
  ],
});
```

## API

`logger(options?)`

Options:

- `logDataOnSuccess?: boolean`
- `pinoOptions?: pino.LoggerOptions`

When `logDataOnSuccess` is `true`, the plugin logs the parsed success payload in addition to the response status.

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

## Relationship To `@kanonic/fetch`

This package is just a plugin built on top of the public `KanonicPlugin` interface from `@kanonic/fetch`.

If you need custom log formatting, request correlation, redaction, or tracing metadata, you can use this package as-is or as a starting point for your own plugin.
