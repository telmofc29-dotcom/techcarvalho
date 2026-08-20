"use client";

import { useEffect } from "react";

// Admin-only error boundary: an unexpected failure (a thrown Supabase
// error from reference-service.ts, a bug, etc.) must be visibly reported
// to the administrator, not swallowed into what looks like an empty
// registry. Distinct from ordinary empty states, which are rendered
// deliberately by each page itself.
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[admin-error]", error);
  }, [error]);

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6">
      <h1 className="text-sm font-semibold text-red-900 mb-2">Something went wrong loading this page</h1>
      <p className="text-sm text-red-800 mb-4">
        {error.message || "An unexpected error occurred."} This is a real failure, not an empty registry — check
        the server logs for details.
      </p>
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
