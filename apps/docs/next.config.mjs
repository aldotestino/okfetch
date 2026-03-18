import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();
const rawBasePath = process.env.PAGES_BASE_PATH?.trim();
const normalizedBasePath =
  rawBasePath && rawBasePath !== "/"
    ? rawBasePath.startsWith("/")
      ? rawBasePath
      : `/${rawBasePath}`
    : "";

/** @type {import('next').NextConfig} */
const config = {
  serverExternalPackages: [
    "@takumi-rs/image-response",
    "typescript",
    "twoslash",
    "@okfetch/fetch",
    "@okfetch/api",
    "@okfetch/logger",
  ],
  assetPrefix: normalizedBasePath ? `${normalizedBasePath}/` : undefined,
  basePath: normalizedBasePath,
  output: "export",
  reactStrictMode: true,
  trailingSlash: true,
};

export default withMDX(config);
