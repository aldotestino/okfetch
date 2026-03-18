import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="text-sm text-fd-muted-foreground">TypeScript-first HTTP tooling</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
        Documentation for the okfetch package family
      </h1>
      <p className="mt-4 max-w-2xl text-fd-muted-foreground">
        Learn when to use <code>@okfetch/fetch</code>, <code>@okfetch/api</code>, and{' '}
        <code>@okfetch/logger</code>, then dive into the request model, validation flow,
        and practical examples.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Link href="/docs" className="font-medium underline underline-offset-4">
          Open the docs
        </Link>
        <Link
          href="https://github.com/aldotestino/okfetch"
          className="text-fd-muted-foreground underline underline-offset-4"
        >
          View on GitHub
        </Link>
      </div>
    </div>
  );
}
