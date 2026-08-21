import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { sanitizeSearchTerm } from "@/lib/search/sanitize";
import { ADMIN_PAGE_SIZE, parsePage } from "@/lib/admin/pagination";
import { getAdminPreviewUrl } from "@/lib/media/admin-preview-url";
import { PageHeader, LinkButton, EmptyState, QueryErrorBanner } from "@/components/admin/ui";
import { SearchBox } from "@/components/admin/search-box";
import { AdminFilterSelect } from "@/components/admin/filter-select";
import { Pagination } from "@/components/admin/pagination";
import { MediaGrid } from "./media-grid";
import type { MediaRightsStatus, MediaSourceType } from "@/lib/types/database";

const RIGHTS_FILTERS: { label: string; value: MediaRightsStatus | "" }[] = [
  { label: "All", value: "" },
  { label: "Unknown", value: "unknown" },
  { label: "Pending", value: "pending_verification" },
  { label: "Verified", value: "verified" },
  { label: "Restricted", value: "restricted" },
];

const VALID_SOURCE_TYPES: MediaSourceType[] = [
  "manufacturer",
  "staff_photograph",
  "stock_licensed",
  "user_submitted",
  "press_kit",
  "public_domain_or_cc",
  "tc_graphic",
  "other",
];

export default async function MediaListPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    rights?: string;
    type?: string;
    source?: string;
    status?: string;
    brand?: string;
  }>;
}) {
  await requireAdmin();
  const { q: rawQ, page: rawPage, rights, type, source, status, brand } = await searchParams;
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
  if (rightsFilter) query = query.eq("rights_status", rightsFilter);
  if (type === "image" || type === "video") query = query.eq("media_type", type);
  if (source && VALID_SOURCE_TYPES.includes(source as MediaSourceType)) {
    query = query.eq("source_type", source as MediaSourceType);
  }
  if (status === "published") query = query.eq("publication_status", "published");
  if (status === "private") query = query.eq("publication_status", "private");
  if (brand === "brand") query = query.not("brand_role", "is", null);
  if (brand === "editorial") query = query.is("brand_role", null);

  const { data, count, error } = await query;
  const media = data ?? [];
  const pageCount = Math.max(1, Math.ceil((count ?? 0) / ADMIN_PAGE_SIZE));
  const previewUrls = await Promise.all(media.map((m) => getAdminPreviewUrl(m)));
  const items = media.map((m, i) => ({ ...m, previewUrl: previewUrls[i] }));

  const otherParams = { q, rights, type, source, status, brand };

  return (
    <div>
      <PageHeader
        title="Media"
        description="Images and video referenced by products, content, and site branding. Uploads are private until explicitly published."
        action={<LinkButton href="/admin/media/new">Upload media</LinkButton>}
      />

      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <SearchBox action="/admin/media" placeholder="Search by alt text or filename..." defaultValue={q} />
          <div className="flex flex-wrap gap-2">
            {RIGHTS_FILTERS.map((f) => (
              <a
                key={f.value}
                href={`/admin/media${f.value ? `?rights=${f.value}` : ""}`}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  (rights ?? "") === f.value ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
                }`}
              >
                {f.label}
              </a>
            ))}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <AdminFilterSelect
            label="Type"
            paramName="type"
            value={type}
            options={[
              { value: "image", label: "Image" },
              { value: "video", label: "Video" },
            ]}
            otherParams={otherParams}
            action="/admin/media"
          />
          <AdminFilterSelect
            label="Source"
            paramName="source"
            value={source}
            options={[
              { value: "manufacturer", label: "Manufacturer" },
              { value: "staff_photograph", label: "Staff photograph" },
              { value: "stock_licensed", label: "Stock (licensed)" },
              { value: "user_submitted", label: "User submitted" },
              { value: "press_kit", label: "Press kit" },
              { value: "public_domain_or_cc", label: "Public domain / Creative Commons" },
              { value: "tc_graphic", label: "TechCarvalho-created graphic/diagram" },
              { value: "other", label: "Other" },
            ]}
            otherParams={otherParams}
            action="/admin/media"
          />
          <AdminFilterSelect
            label="Status"
            paramName="status"
            value={status}
            options={[
              { value: "published", label: "Published" },
              { value: "private", label: "Private" },
            ]}
            otherParams={otherParams}
            action="/admin/media"
          />
          <AdminFilterSelect
            label="Kind"
            paramName="brand"
            value={brand}
            options={[
              { value: "brand", label: "Brand assets only" },
              { value: "editorial", label: "Editorial/product only" },
            ]}
            otherParams={otherParams}
            action="/admin/media"
          />
        </div>
      </div>

      {error && <QueryErrorBanner message={error.message} />}

      {items.length === 0 ? (
        !error && (
          <EmptyState
            title={q || rights || type || source || status || brand ? "No media matches your filters" : "No media uploaded yet"}
            action={
              !q && !rights && !type && !source && !status && !brand ? (
                <LinkButton href="/admin/media/new">Upload media</LinkButton>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <MediaGrid items={items} />
          <Pagination page={page} pageCount={pageCount} basePath="/admin/media" searchParams={otherParams} />
        </>
      )}
    </div>
  );
}
