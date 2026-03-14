// plugins.ts
import type { KanonicPlugin } from "@kanonic/fetch";

// ─── Logger plugin ────────────────────────────────────────────────────────────

/**
 * A logger plugin that prints every lifecycle event to the console.
 * Has no `init` function — it only observes, never modifies.
 */
export const loggerPlugin: KanonicPlugin = {
  name: "logger",
  version: "1.0.0",
  hooks: {
    async onRequest(ctx) {
      console.log(`[logger] → ${ctx.method} ${ctx.url}`);
      return ctx;
    },
    async onResponse(ctx, response) {
      console.log(
        `[logger] ← ${response.status} ${response.statusText || "(no status text)"} (${ctx.method} ${ctx.url})`
      );
      return response;
    },
    async onSuccess(_ctx, _response, data) {
      console.log("[logger] ✓ success:", JSON.stringify(data).slice(0, 120));
    },
    async onFail(_ctx, _response, error) {
      console.error(`[logger] ✗ error [${error._tag}]:`, error.message);
    },
    async onRetry(ctx, _response, error, attempt) {
      console.warn(
        `[logger] ↺ retry ${attempt + 1} for ${ctx.method} ${ctx.url} after [${error._tag}]:`,
        error.message
      );
    },
  },
};
const totalTimings = new Map<string, number>();
const attemptTimings = new Map<string, number>();
const timingHeader = "x-kanonic-timing-id";

const resolveTimingId = (value: string | null): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const finishTiming = (id: string | null, symbol: string) => {
  if (!id) {
    return;
  }

  const startedAt = totalTimings.get(id);
  if (startedAt === undefined) {
    return;
  }

  totalTimings.delete(id);
  attemptTimings.delete(id);
  const totalMs = (performance.now() - startedAt).toFixed(1);
  console.log(`[timing] ${symbol} total ${totalMs}ms`);
};

export const timingPlugin: KanonicPlugin = {
  name: "timing",
  version: "1.0.0",
  async init({ options, url }) {
    const requestId = crypto.randomUUID();
    totalTimings.set(requestId, performance.now());

    return {
      url,
      options: {
        ...options,
        headers: {
          ...options.headers,
          [timingHeader]: requestId,
        },
      },
    };
  },
  hooks: {
    async onRequest(ctx) {
      const requestId = resolveTimingId(ctx.headers.get(timingHeader));
      if (requestId) {
        attemptTimings.set(requestId, performance.now());
      }
      return ctx;
    },
    async onResponse(ctx, response) {
      const requestId = resolveTimingId(ctx.headers.get(timingHeader));
      const attemptStart = requestId
        ? attemptTimings.get(requestId)
        : undefined;
      if (attemptStart !== undefined) {
        attemptTimings.delete(requestId as string);
        const attemptMs = (performance.now() - attemptStart).toFixed(1);
        console.log(
          `[timing] attempt ${attemptMs}ms → ${response.status} ${ctx.method} ${ctx.url}`
        );
      }
      return response;
    },
    async onSuccess(ctx) {
      finishTiming(resolveTimingId(ctx.headers.get(timingHeader)), "✓");
    },
    async onFail(ctx) {
      finishTiming(resolveTimingId(ctx.headers.get(timingHeader)), "✗");
    },
  },
};
