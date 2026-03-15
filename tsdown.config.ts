import { defineConfig } from "tsdown";

const sharedConfig = defineConfig({
  clean: true,
  deps: {
    neverBundle: [/^@okfetch\//, "better-result", "pino", /^zod(?:\/.*)?$/],
  },
  dts: true,
  format: ["esm", "cjs"],
  sourcemap: true,
});

export default defineConfig([
  {
    ...sharedConfig,
    entry: ["packages/fetch/src/index.ts"],
    outDir: "packages/fetch/dist",
  },
  {
    ...sharedConfig,
    entry: ["packages/api/src/index.ts"],
    outDir: "packages/api/dist",
  },
  {
    ...sharedConfig,
    entry: ["packages/logger/index.ts"],
    outDir: "packages/logger/dist",
  },
]);
