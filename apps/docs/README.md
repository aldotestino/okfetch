# @okfetch/docs

The documentation site for okfetch, built with [Fumadocs](https://fumadocs.dev) and Next.js.

## Development

From the repo root:

```bash
bun run docs:dev
```

The site runs on http://localhost:3000, with the docs at `/docs`.

```bash
bun run docs:build
```

## Content

Pages live in `content/docs` as MDX. The sidebar order is defined in
`content/docs/meta.json`; `icon` frontmatter accepts any [lucide](https://lucide.dev) icon name.

One page per package, plus an introduction that covers the concepts shared by all of them —
serialization rules, validation boundaries, and the `Result` model. Keep those in the
introduction rather than repeating them per package.

## Tooling

This app owns its own lint (`.oxlintrc.json`, with the react and nextjs plugins) and
formatting style. The root `oxfmt` config and `tsconfig` exclude `apps/**` for that reason —
run `bun run lint` and `bun run types:check` from inside this directory.
