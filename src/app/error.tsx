"use client";

import { useEffect } from "react";
import Link from "next/link";

// Public-facing crash boundary. Deliberately generic — never leak the
// underlying error message to a visitor — but logged server/client-side so
// it's discoverable.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[public-error]", error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-accent">Error</p>
      <h1 className="font-display text-4xl font-bold tracking-tight text-zinc-900">Something went wrong</h1>
      <p className="text-zinc-500 max-w-sm">
        We hit an unexpected error loading this page. Try again, or head back to the homepage.
      </p>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-zinc-900 text-white px-5 py-2.5 text-sm font-medium hover:bg-zinc-700"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full border border-border-subtle px-5 py-2.5 text-sm font-medium hover:border-accent/40"
        >
          Homepage
        </Link>
      </div>
    </main>
  );
}
