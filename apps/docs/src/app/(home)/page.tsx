import Link from 'next/link';

const packages = [
  {
    name: '@okfetch/fetch',
    href: '/docs/fetch',
    description: 'The transport core: validation, retries, timeouts, auth, streaming, plugins.',
  },
  {
    name: '@okfetch/api',
    href: '/docs/api',
    description: 'Endpoint trees that compile into a fully typed client.',
  },
  {
    name: '@okfetch/logger',
    href: '/docs/logger',
    description: 'A pino plugin for request, success, failure and retry logging.',
  },
  {
    name: '@okfetch/otel',
    href: '/docs/otel',
    description: 'One OpenTelemetry CLIENT span per request, redaction included.',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-col items-center justify-center flex-1 px-4 py-16 text-center">
      <h1 className="text-4xl font-bold font-mono">okfetch</h1>
      <p className="mt-4 max-w-xl text-fd-muted-foreground">
        A small family of TypeScript-first HTTP packages that make <code>fetch</code> safer and
        more composable — without hiding how the web platform works.
      </p>

      <div className="mt-8 flex gap-3">
        <Link
          href="/docs"
          className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
        >
          Read the docs
        </Link>
        <a
          href="https://github.com/aldotestino/okfetch"
          rel="noopener noreferrer"
          target="_blank"
          className="rounded-lg border px-4 py-2 text-sm font-medium"
        >
          GitHub
        </a>
      </div>

      <div className="mt-14 grid w-full max-w-3xl gap-3 sm:grid-cols-2">
        {packages.map((pkg) => (
          <Link
            key={pkg.name}
            href={pkg.href}
            className="rounded-xl border bg-fd-card p-4 text-left transition-colors hover:bg-fd-accent"
          >
            <p className="font-mono text-sm font-medium">{pkg.name}</p>
            <p className="mt-1 text-sm text-fd-muted-foreground">{pkg.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
