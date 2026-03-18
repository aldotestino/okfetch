import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  serverExternalPackages: ['@takumi-rs/image-response', 'typescript', 'twoslash', "@okfetch/fetch", "@okfetch/api", "@okfetch/logger"],
  output: 'export',
  reactStrictMode: true,
};

export default withMDX(config);
