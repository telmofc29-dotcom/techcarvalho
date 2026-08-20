import "server-only";

// Server-side-only logging for query failures that the UI intentionally
// degrades gracefully around (public pages show an honest empty state
// rather than a raw error). The point is that a permission/config failure
// must still be *discoverable* — in Vercel/server logs — even though a
// visitor never sees it. See the 2026-08 anon-grant incident: every public
// page silently rendered "Coming soon" while every query was actually
// failing, and nothing surfaced that until it was checked with raw curl.
export function logQueryError(context: string, error: { message: string } | null | undefined): void {
  if (!error) return;
  console.error(`[query-error] ${context}: ${error.message}`);
}
