import Link from "next/link";
import { PageHeader, Card } from "@/components/admin/ui";

// ADMIN NOT-FOUND BOUNDARY.
//
// WHY THIS FILE EXISTS
// --------------------
// There was no not-found boundary anywhere under /admin. Every admin page that
// calls notFound() for a missing row — media, content, products, engine topics,
// every reference table — fell through to the ROOT not-found at
// src/app/not-found.tsx, which renders inside the PUBLIC site layout.
//
// So deleting a media asset ended like this: the delete succeeded, the browser
// stayed on /admin/media/[deleted-id], that page called notFound(), and the
// admin was thrown onto the public TechCarvalho 404 with its marketing header
// and footer. It reads exactly like something has been destroyed, and nothing
// had been.
//
// Being inside the (dashboard) route group, this inherits the admin layout, so
// a missing record now looks like what it is: an admin page reporting that a
// row is gone, with the navigation still there.
//
// ONE BOUNDARY, NOT A PER-PAGE FIX
// --------------------------------
// Next.js resolves not-found.tsx to the nearest boundary above the segment that
// threw, so this single file covers every current and future admin page without
// any of them importing anything. That is deliberate: the alternative was a
// bespoke "not found" screen per resource, which is how five of them end up
// behaving differently.

export default function AdminNotFound() {
  return (
    <div>
      <PageHeader
        title="Not found"
        description="That record no longer exists. It may have been deleted, or the link may be stale."
      />

      <Card className="p-6">
        <p className="text-sm text-neutral-600 max-w-prose">
          If you have just deleted something, this is expected — the record is gone and the page
          that showed it went with it. Nothing else was removed: deleting a media asset detaches it
          from any articles or products that used it and leaves those records untouched.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/admin/media"
            className="inline-flex items-center rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
          >
            Back to media
          </Link>
          <Link
            href="/admin"
            className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-neutral-700 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
          >
            Dashboard
          </Link>
          <Link
            href="/admin/content"
            className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-neutral-700 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
          >
            Content
          </Link>
        </div>
      </Card>
    </div>
  );
}
