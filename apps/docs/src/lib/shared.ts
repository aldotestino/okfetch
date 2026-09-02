export const appName = 'okfetch';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

export const gitConfig = {
  user: 'aldotestino',
  repo: 'okfetch',
  branch: 'main',
};

export const appDescription =
  'A small family of TypeScript-first HTTP packages that make fetch safer and more composable, without hiding how the web platform works.';

// Absolute base for canonical and Open Graph URLs. Vercel exposes the
// deployment host without a scheme; fall back to localhost in development.
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
  : process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    : new URL('http://localhost:3000');
