import Link from "next/link";
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
import { getMediaComposition } from "@/lib/admin/media-composition";
import type { MediaAssetRole, MediaRightsStatus, MediaSourceType } from "@/lib/types/database";
import { ASSET_ROLE_OPTIONS, VALID_ASSET_ROLES } from "@/lib/media/form-options";

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
    role?: string;
    usage?: string;
  }>;
}) {
  await requireAdmin();
  const { q: rawQ, page: rawPage, rights, type, source, status, brand, role, usage } = await searchParams;
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

  // Editorial role — "what is this image?" — which the library could filter on
  // nowhere, despite it being the field that separates a product photograph
  // from a concept render.
  if (role === "__unset") query = query.is("asset_role", null);
  else if (role && VALID_ASSET_ROLES.includes(role as MediaAssetRole)) {
    query = query.eq("asset_role", role as MediaAssetRole);
  }

  // Usage. Attached/unattached needs the join tables, so it is applied as an id
  // filter rather than a column filter.
  if (usage === "attached" || usage === "unattached") {
    const [{ data: pmRows }, { data: cmRows }] = await Promise.all([
      supabase.from("product_media").select("media_id"),
      supabase.from("content_media").select("media_id"),
    ]);
    const usedIds = [...new Set([...(pmRows ?? []).map((r) => r.media_id), ...(cmRows ?? []).map((r) => r.media_id)])];
    if (usage === "attached") {
      query = usedIds.length > 0 ? query.in("id", usedIds) : query.eq("id", "00000000-0000-0000-0000-000000000000");
    } else if (usedIds.length > 0) {
      query = query.not("id", "in", `(${usedIds.join(",")})`);
    }
  }

  const { data, count, error } = await query;
  // What the library is MADE OF, not merely how many rows it has. "112 assets"
  // was accurate and told nobody that 65 of them are generated graphics and
  // none are our own photographs.
  const composition = await getMediaComposition();
  const media = data ?? [];
  const pageCount = Math.max(1, Math.ceil((count ?? 0) / ADMIN_PAGE_SIZE));
  const previewUrls = await Promise.all(media.map((m) => getAdminPreviewUrl(m)));
  const items = media.map((m, i) => ({ ...m, previewUrl: previewUrls[i] }));

  const otherParams = { q, rights, type, source, status, brand, role, usage };

  return (
    <div>
      <PageHeader
        title="Media"
        description="Images and video referenced by products, content, and site branding. Uploads are private until explicitly published."
        action={
          <div className="flex gap-2">
            <LinkButton href="/admin/media/requirements">Awaiting media</LinkButton>
            <LinkButton href="/admin/media/new">Upload media</LinkButton>
          </div>
        }
      />

      {/* The composition strip. A total on its own cannot change a decision;
          the split between real photography and generated graphics can, and it
          is the reason the public site looks synthetic. */}
      <dl className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-4 lg:grid-cols-7">
        {[
          ["Records", composition.records, null],
          ["Unique files", composition.distinctPaths, null],
          ["Photographs", composition.photographs, null],
          ["Ours", composition.ownedPhotographs, composition.ownedPhotographs === 0 ? "amber" : null],
          ["Generated", composition.generated, null],
          ["Logos", composition.logos, null],
          ["Unattached", composition.unattached, composition.unattached > 0 ? "amber" : null],
        ].map(([label, value, tone]) => (
          <div key={String(label)}>
            <dt className="text-xs text-neutral-500">{label}</dt>
            <dd
              className={`text-xl font-semibold tabular-nums ${
                tone === "amber" ? "text-amber-700" : "text-neutral-900"
              }`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {composition.ownedPhotographs === 0 && (
        <p className="mb-4 text-xs leading-relaxed text-neutral-500">
          No photographs taken by {"Tech Carvalho"} yet. {composition.generated} of{" "}
          {composition.records} records are generated graphics, which is why article cards
          look alike on the public site. See{" "}
          <Link href="/admin/photography" className="underline hover:text-neutral-800">
            photography triage
          </Link>{" "}
          for what to shoot first.
        </p>
      )}

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
          {/* What the image IS — the field that separates a product photograph
              from a concept render, and which the library could not filter on. */}
          <AdminFilterSelect
            label="Editorial role"
            paramName="role"
            value={role}
            options={[
              { value: "__unset", label: "Not set" },
              ...ASSET_ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
            ]}
            otherParams={otherParams}
            action="/admin/media"
          />
          {/* "Which of these is doing nothing?" was previously unanswerable
              without running the audit script. */}
          <AdminFilterSelect
            label="Usage"
            paramName="usage"
            value={usage}
            options={[
              { value: "attached", label: "Used somewhere" },
              { value: "unattached", label: "Not used anywhere" },
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
            title={q || rights || type || source || status || brand || role || usage ? "No media matches your filters" : "No media uploaded yet"}
            action={
              !q && !rights && !type && !source && !status && !brand && !role && !usage ? (
                <LinkButton href="/admin/media/new">Upload media</LinkButton>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <MediaGrid items={items} />
          <Pagination page={page} pageCount={pageCount} basePath="/admin/media" searchParams={otherParams} total={count ?? undefined} itemNoun="asset" />
        </>
      )}
    </div>
  );
}
