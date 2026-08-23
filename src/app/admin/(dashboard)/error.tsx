"use client";

import { useEffect } from "react";

// Admin-only error boundary: an unexpected failure (a thrown Supabase
// error from reference-service.ts, a bug, etc.) must be visibly reported
// to the administrator, not swallowed into what looks like an empty
// registry. Distinct from ordinary empty states, which are rendered
// deliberately by each page itself.
//
// WHY THE DIGEST IS ON SCREEN
// ---------------------------
// In a production build React refuses to send the real message to the browser.
// Every Server Component failure arrives here as "Minified React error #441",
// which says only "something threw" — the same text for a null property access,
// a failed query, and a missing environment variable.
//
// What React DOES send is `error.digest`, a hash identifying that specific
// error. src/instrumentation.ts logs the real exception and stack against the
// same digest. So the digest is the one piece of information that turns an
// unreadable screen into a findable log line, and it was previously being
// dropped on the floor: the boundary received it and rendered only the masked
// message.
//
// It is displayed, selectable, alongside the build that produced it, because a
// report of "it is broken" and a report of "digest 1a2b3c on commit d4e5f6g"
// are not the same thing.
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep the full object in the browser console for anyone with devtools
    // open; the on-screen copy is for the case where they do not.
    console.error("[admin-error]", { message: error.message, digest: error.digest, error });
  }, [error]);

  const isMasked = /Minified React error #441/.test(error.message);

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6">
      <h1 className="text-sm font-semibold text-red-900 mb-2">Something went wrong loading this page</h1>
      <p className="text-sm text-red-800 mb-4">
        {error.message || "An unexpected error occurred."} This is a real failure, not an empty registry — check
        the server logs for details.
      </p>

      {isMasked && (
        <p className="text-xs text-red-800 mb-4">
          React hides the real message in production builds. The digest below identifies this exact failure in the
          server log — search the logs for it.
        </p>
      )}

      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-red-900">
        <dt className="font-semibold">Digest</dt>
        <dd className="font-mono select-all break-all">{error.digest ?? "not provided"}</dd>
        <dt className="font-semibold">Build</dt>
        {/* Inlined at build time by Next for NEXT_PUBLIC_*; falls back to the
            literal below when running locally, where no deployment exists. */}
        <dd className="font-mono select-all break-all">
          {process.env.NEXT_PUBLIC_BUILD_COMMIT || "local / unknown"}
        </dd>
      </dl>

      <button
        type="button"
        onClick={reset}
        className="rounded px-3 py-2 text-sm font-medium bg-red-900 text-white hover:bg-red-800"
      >
        Try again
      </button>
    </div>
  );
}
