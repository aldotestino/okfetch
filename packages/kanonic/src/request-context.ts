import type {
  KanonicBody,
  KanonicOptions,
  KanonicRequestContext,
} from "./types";

const nonBodyMethods = new Set(["HEAD", "OPTIONS"]);

const isDirectBody = (value: unknown): value is KanonicBody =>
  value instanceof FormData ||
  value instanceof URLSearchParams ||
  value instanceof Blob ||
  typeof value === "string" ||
  value instanceof ArrayBuffer ||
  ArrayBuffer.isView(value) ||
  value instanceof ReadableStream;

const resolveUrl = (url: string, options: KanonicOptions): URL => {
  let urlWithParams = url;
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      urlWithParams = urlWithParams.replace(
        new RegExp(`:${key}(?=[/?]|$)`),
        encodeURIComponent(String(value))
      );
    }
  }

  const resolvedUrl = options.baseURL
    ? new URL(
        urlWithParams.startsWith("/") ? urlWithParams.slice(1) : urlWithParams,
        options.baseURL.endsWith("/") ? options.baseURL : `${options.baseURL}/`
      )
    : new URL(urlWithParams);

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          resolvedUrl.searchParams.append(key, String(item));
        }
        continue;
      }

      resolvedUrl.searchParams.append(key, String(value));
    }
  }

  return resolvedUrl;
};

const resolveHeaders = (options: KanonicOptions): Headers => {
  const headers = new Headers(options.headers);

  if (!options.auth) {
    return headers;
  }

  switch (options.auth.type) {
    case "basic": {
      const credentials = btoa(
        `${options.auth.username}:${options.auth.password}`
      );
      headers.set("Authorization", `Basic ${credentials}`);
      break;
    }
    case "bearer": {
      headers.set("Authorization", `Bearer ${options.auth.token}`);
      break;
    }
    default: {
      headers.set(
        "Authorization",
        `${options.auth.prefix} ${options.auth.value}`
      );
    }
  }

  return headers;
};

const resolveBody = (
  method: KanonicRequestContext["method"],
  options: KanonicOptions,
  headers: Headers
): KanonicBody | undefined => {
  if (nonBodyMethods.has(method) || !options.body) {
    return undefined;
  }

  if (
    headers.has("Content-Type") &&
    headers.get("Content-Type")?.includes("x-www-form-urlencoded")
  ) {
    const searchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(
      options.body as Record<string, string | readonly string[]>
    )) {
      if (Array.isArray(value)) {
        for (const item of value) {
          searchParams.append(key, item);
        }
        continue;
      }

      searchParams.append(key, String(value));
    }

    return searchParams.toString();
  }

  if (isDirectBody(options.body)) {
    return options.body;
  }

  return JSON.stringify(options.body);
};

export const buildRequestContext = (
  url: string,
  options: KanonicOptions
): KanonicRequestContext => {
  const method = options.method ?? (options.body ? "POST" : "GET");
  const headers = resolveHeaders(options);
  const controller = new AbortController();
  const {
    apiErrorDataSchema: _apiErrorDataSchema,
    auth: _auth,
    baseURL: _baseURL,
    body: _rawBody,
    errorSchema: _errorSchema,
    fetch: _fetch,
    headers: _headers,
    method: _method,
    outputSchema: _outputSchema,
    params: _params,
    plugins: _plugins,
    query: _query,
    retry: _retry,
    stream: _stream,
    timeout: _timeout,
    validateOutput: _validateOutput,
    shouldValidateError: _shouldValidateError,
    _retryAttempt,
    ...requestInit
  } = options;

  return {
    ...requestInit,
    body: resolveBody(method, options, headers),
    headers,
    method,
    signal: options.signal ?? controller.signal,
    url: resolveUrl(url, options),
  };
};
