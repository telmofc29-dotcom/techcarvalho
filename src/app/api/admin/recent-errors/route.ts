import { NextResponse, type NextRequest } from "next/server";

import { getCurrentAdmin } from "@/lib/dal";
import { getBuildInfo } from "@/lib/build-info";
import { findByDigest, recentErrors } from "@/lib/log/recent-errors";

// Read back the real exception behind a masked React #441, from the browser.
//
// The admin error screen shows a digest; src/instrumentation.ts captures the
// true exception and stack against that same digest. This exposes that capture
// to an authenticated admin so the message can be recovered without platform
// log access.
//
// ADMIN ONLY, and gated by getCurrentAdmin() rather than requireAdmin():
// requireAdmin() answers with redirect(), which is right for a page and wrong
// for an endpoint — a 307 to an HTML login page is not a useful response to a
// fetch. This answers 401 instead. RLS remains the authoritative boundary
// underneath regardless.
//
// Usage:
//   /api/admin/recent-errors                    -> the last few, newest first
//   /api/admin/recent-errors?digest=123@E394    -> just that one
export async function GET(request: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Not authenticated as an admin." }, { status: 401 });
  }

  const digest = request.nextUrl.searchParams.get("digest");
  const build = getBuildInfo();

  if (digest) {
    const match = findByDigest(digest);
    return NextResponse.json(
      {
        build,
        digest,
        found: match !== null,
        // A miss is not evidence of anything: this buffer is per-instance and
        // the failing request may have been served by a different one. Say so
        // in the response rather than letting an empty result read as "no error
        // happened".
        note:
          match === null
            ? "Not found on THIS instance. The buffer is per-instance and best-effort — this does not mean the error did not occur. Check the platform logs for [request-error] with this digest."
            : null,
        error: match,
      },
      { headers: { "cache-control": "no-store" } }
    );
  }

  const entries = recentErrors();
  return NextResponse.json(
    {
      build,
      count: entries.length,
      note:
        entries.length === 0
          ? "No errors captured on this instance. Per-instance and best-effort — check the platform logs for [request-error]."
          : null,
      errors: entries,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
