import Image from "next/image";
import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { sanitizeSearchTerm } from "@/lib/search/sanitize";
import { ADMIN_PAGE_SIZE, parsePage } from "@/lib/admin/pagination";
import { getAdminPreviewUrl } from "@/lib/media/admin-preview-url";
import { PageHeader, LinkButton, EmptyState, Badge, QueryErrorBanner } from "@/components/admin/ui";
import { SearchBox } from "@/components/admin/search-box";
import { Pagination } from "@/components/admin/pagination";
import type { MediaRightsStatus } from "@/lib/types/database";

const RIGHTS_FILTERS: { label: string; value: MediaRightsStatus | "" }[] = [
  { label: "All", value: "" },
  { label: "Unknown", value: "unknown" },
  { label: "Pending", value: "pending_verification" },
  { label: "Verified", value: "verified" },
  { label: "Restricted", value: "restricted" },
];

const RIGHTS_TONE: Record<MediaRightsStatus, "red" | "amber" | "green" | "neutral"> = {
  restricted: "red",
  pending_verification: "amber",
  verified: "green",
  unknown: "neutral",
};

export default async function MediaListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; rights?: string }>;
}) {
  await requireAdmin();
  const { q: rawQ, page: rawPage, rights } = await searchParams;
  const q = rawQ ? sanitizeSearchTerm(rawQ) : "";
  const page = parsePage(rawPage);
  const from = (page - 1) * ADMIN_PAGE_SIZE;
  const to = from + ADMIN_PAGE_SIZE - 1;

  const supabase = await createClient();
  let query = supabase
    .from("media_assets")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (q) query = query.or(`alt_text.ilike.%${q}%,storage_path.ilike.%${q}%`);
  const rightsFilter = RIGHTS_FILTERS.find((f) => f.value === rights && f.value !== "")?.value;
  if (rightsFilter) {
    query = query.eq("rights_status", rightsFilter);
  }
  const { data, count, error } = await query;
  const media = data ?? [];
  const pageCount = Math.max(1, Math.ceil((count ?? 0) / ADMIN_PAGE_SIZE));
  const previewUrls = await Promise.all(media.map((m) => getAdminPreviewUrl(m)));

  return (
    <div>
      <PageHeader
        title="Media"
        description="Images and video referenced by products and content. Uploads are private until explicitly published."
        action={<LinkButton href="/admin/media/new">Upload media</LinkButton>}
      />

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <SearchBox action="/admin/media" placeholder="Search by alt text or filename..." defaultValue={q} />
        <div className="flex flex-wrap gap-2">
          {RIGHTS_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={`/admin/media${f.value ? `?rights=${f.value}` : ""}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                (rights ?? "") === f.value ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      {error && <QueryErrorBanner message={error.message} />}

      {media.length === 0 ? (
        !error && (
          <EmptyState
            title={q || rights ? "No media matches your filters" : "No media uploaded yet"}
            action={!q && !rights ? <LinkButton href="/admin/media/new">Upload media</LinkButton> : undefined}
          />
        )
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {media.map((m, i) => {
              const previewUrl = previewUrls[i];
              const isPublished = m.publication_status === "published";
              const rightsStatus = m.rights_status ?? "unknown";
              return (
                <Link key={m.id} href={`/admin/media/${m.id}`}>
                  <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden hover:border-neutral-400">
                    <div className="aspect-video bg-neutral-100 relative flex items-center justify-center">
                      {m.media_type === "image" && previewUrl ? (
                        <Image src={previewUrl} alt={m.alt_text ?? ""} fill className="object-cover" unoptimized />
                      ) : (
                        <span className="text-xs text-neutral-500">
                          {m.media_type === "video" ? "Video" : "No preview"}
                        </span>
                      )}
                    </div>
                    <div className="p-2 flex items-center justify-between gap-1">
                      <p className="text-xs text-neutral-700 truncate">{m.storage_path.split("/").pop()}</p>
                      <div className="flex gap-1 shrink-0">
                        <Badge tone={isPublished ? "green" : "neutral"}>{isPublished ? "Published" : "Private"}</Badge>
                        <Badge tone={RIGHTS_TONE[rightsStatus]}>{rightsStatus.replace("_", " ")}</Badge>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
          <Pagination page={page} pageCount={pageCount} basePath="/admin/media" searchParams={{ q, rights }} />
        </>
      )}
    </div>
  );
}
