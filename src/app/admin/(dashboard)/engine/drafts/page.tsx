import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { evaluateMediaReadiness } from "@/lib/media/requirements";
import {
  PageHeader,
  Card,
  Badge,
  TextLink,
  EmptyState,
  QueryErrorBanner,
} from "@/components/admin/ui";
import type {
  ContentStatus,
  Database,
  MediaRightsStatus,
  MediaSourceType,
  MediaSourcingStatus,
} from "@/lib/types/database";
import {
  BriefKindBadge,
  EngineTabs,
  FreshnessSensitivityBadge,
  StateBadge,
  formatDateTime,
  humanise,
} from "../shared";

// Phase 6 — the editorial review surface for drafts the engine assembled.
//
// What this page is for: judging EVIDENCE QUALITY quickly. An assembled draft
// is a structured evidence dossier, not an article — its body contains quoted
// findings and an explicit unverified block, and a human still writes the
// prose. So the layout puts the verified/unverified split, the sources and the
// media blocker above everything else, because those are what decide whether
// the draft is worth an editor's afternoon.
//
// What this page deliberately cannot do: publish. There is no publish control
// here and no action that changes content_items.status. Opening the draft in
// the normal content editor is the only route onward, which keeps the existing
// editorial workflow and the media-first gate in the path.

const MEDIA_FILTERS = [
  { value: "", label: "All assembled" },
  { value: "blocked", label: "Blocked on media" },
  { value: "ready", label: "Passes media gate" },
] as const;

type HeroAsset = {
  rights_status: MediaRightsStatus;
  owned: boolean;
  source_type: MediaSourceType | null;
};

// Derived from the schema type rather than restated, so a column renamed in
// database.ts breaks this file at compile time instead of at render time. The
// explicit annotation is needed because supabase-js only infers row shapes
// from a single string literal, and this column list is too long for one.
const BRIEF_COLUMNS =
  "id, proposed_title, proposed_slug, content_type, category_slug, search_intent, primary_query, " +
  "rationale, primary_question, verified_facts, uncertainties, source_urls, suggested_structure, " +
  "related_product_slugs, related_content_slugs, media_requirement_note, brief_kind, " +
  "freshness_sensitivity, state, state_reason, priority, review_note, " +
  "assembled_content_id, assembled_at, assembly_note";

type BriefRow = Pick<
  Database["public"]["Tables"]["engine_briefs"]["Row"],
  | "id"
  | "proposed_title"
  | "proposed_slug"
  | "content_type"
  | "category_slug"
  | "search_intent"
  | "primary_query"
  | "rationale"
  | "primary_question"
  | "verified_facts"
  | "uncertainties"
  | "source_urls"
  | "suggested_structure"
  | "related_product_slugs"
  | "related_content_slugs"
  | "media_requirement_note"
  | "brief_kind"
  | "freshness_sensitivity"
  | "state"
  | "state_reason"
  | "priority"
  | "review_note"
  | "assembled_content_id"
  | "assembled_at"
  | "assembly_note"
>;

export default async function EngineDraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ media?: string }>;
}) {
  await requireAdmin();
  const { media } = await searchParams;
  const supabase = await createClient();

  const activeMedia = MEDIA_FILTERS.find((f) => f.value !== "" && f.value === media)?.value ?? "";

  // Assembled = the brief points at a real content row. `assembled_content_id`
  // is set only by engine_assemble_draft, so this is exactly "briefs that
  // produced a draft" and nothing else.
  const { data: briefData, error: briefsError } = await supabase
    .from("engine_briefs")
    .select(BRIEF_COLUMNS)
    .not("assembled_content_id", "is", null)
    .order("assembled_at", { ascending: false, nullsFirst: false })
    .limit(200);

  const briefs = (briefData ?? []) as unknown as BriefRow[];

  const contentIds = briefs
    .map((b) => b.assembled_content_id)
    .filter((id): id is string => typeof id === "string");

  // How many approved briefs have NOT produced a draft. Without this number an
  // editor cannot tell "the assembly stage has nothing to do" from "the
  // assembly stage is stuck", and both look like a short list on this page.
  const { count: unassembledCount, error: unassembledError } = await supabase
    .from("engine_briefs")
    .select("id", { count: "exact", head: true })
    .eq("review_state", "approved")
    .is("assembled_content_id", null)
    .not("state", "in", "(rejected,published)");

  const [
    { data: contentRows, error: contentError },
    { data: requirements, error: requirementsError },
    { data: heroLinks, error: heroLinksError },
  ] = await Promise.all([
    contentIds.length > 0
      ? supabase.from("content_items").select("id, title, slug, status, updated_at").in("id", contentIds)
      : Promise.resolve({
          data: [] as { id: string; title: string; slug: string; status: ContentStatus; updated_at: string }[],
          error: null,
        }),
    contentIds.length > 0
      ? supabase
          .from("media_requirements")
          .select("content_id, sourcing_status, notes")
          .in("content_id", contentIds)
      : Promise.resolve({
          data: [] as { content_id: string | null; sourcing_status: MediaSourcingStatus; notes: string | null }[],
          error: null,
        }),
    contentIds.length > 0
      ? supabase.from("content_media").select("content_id, media_id").eq("role", "hero").in("content_id", contentIds)
      : Promise.resolve({ data: [] as { content_id: string; media_id: string }[], error: null }),
  ]);

  const heroMediaIds = (heroLinks ?? []).map((h) => h.media_id);
  const { data: heroAssets, error: heroAssetsError } =
    heroMediaIds.length > 0
      ? await supabase.from("media_assets").select("id, rights_status, owned, source_type").in("id", heroMediaIds)
      : { data: [] as ({ id: string } & HeroAsset)[], error: null };

  const contentById = new Map((contentRows ?? []).map((c) => [c.id, c]));
  const requirementByContentId = new Map(
    (requirements ?? []).filter((r) => r.content_id).map((r) => [r.content_id as string, r])
  );
  const assetById = new Map((heroAssets ?? []).map((a) => [a.id, a]));
  const heroAssetByContentId = new Map(
    (heroLinks ?? []).map((h) => [h.content_id, assetById.get(h.media_id) ?? null])
  );

  const rows = briefs.map((brief) => {
    const contentId = brief.assembled_content_id as string;
    const content = contentById.get(contentId) ?? null;
    const requirement = requirementByContentId.get(contentId) ?? null;
    const heroAsset = heroAssetByContentId.get(contentId) ?? null;
    // Exactly the gate a publish flow would apply, run here purely to display
    // the blocker. Nothing on this page acts on the result.
    const readiness = evaluateMediaReadiness({
      heroAsset,
      requirement: requirement ? { sourcing_status: requirement.sourcing_status } : null,
    });
    return { brief, contentId, content, requirement, readiness };
  });

  const visible =
    activeMedia === "blocked"
      ? rows.filter((r) => !r.readiness.ready)
      : activeMedia === "ready"
        ? rows.filter((r) => r.readiness.ready)
        : rows;

  const blockedCount = rows.filter((r) => !r.readiness.ready).length;

  // Any failed read means this list is incomplete, and an incomplete list of
  // drafts is not the same as a short one. Report and render nothing.
  const anyError =
    briefsError || contentError || requirementsError || heroLinksError || heroAssetsError;

  const filterHref = (value: string) =>
    `/admin/engine/drafts${value ? `?media=${value}` : ""}`;

  return (
    <div>
      <PageHeader
        title="Assembled drafts"
        description="Briefs the engine turned into draft content records. Every one is a draft awaiting a human writer — assembly creates structure and quoted evidence, never finished prose."
      />
      <EngineTabs current="/admin/engine/drafts" />

      <Card className="p-4 mb-6 border-blue-200 bg-blue-50">
        <p className="text-sm font-medium text-neutral-900">These are drafts, and they stay drafts</p>
        <p className="text-xs text-neutral-700 mt-1">
          An assembled draft is an evidence dossier: quoted findings, an explicit unverified block, and the sources
          behind both. Nothing here has been written, checked or published. There is no publish control on this page by
          design — a draft becomes an article by an editor opening the content record, writing it, satisfying the
          media-first requirement, and publishing through the normal editorial flow.
        </p>
      </Card>

      <div className="flex flex-wrap gap-2 mb-4">
        {MEDIA_FILTERS.map((f) => (
          <a
            key={f.value || "all"}
            href={filterHref(f.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              activeMedia === f.value ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
            }`}
          >
            {f.label}
            {f.value === "blocked" && !anyError ? ` (${blockedCount})` : ""}
          </a>
        ))}
      </div>

      {briefsError && <QueryErrorBanner message={`Failed to load assembled briefs: ${briefsError.message}`} />}
      {contentError && <QueryErrorBanner message={`Failed to load the draft content records: ${contentError.message}`} />}
      {requirementsError && (
        <QueryErrorBanner message={`Failed to load media requirements: ${requirementsError.message}`} />
      )}
      {heroLinksError && <QueryErrorBanner message={`Failed to load hero media links: ${heroLinksError.message}`} />}
      {heroAssetsError && <QueryErrorBanner message={`Failed to load hero media assets: ${heroAssetsError.message}`} />}
      {unassembledError && (
        <QueryErrorBanner message={`Failed to count briefs awaiting assembly: ${unassembledError.message}`} />
      )}

      {!unassembledError && (
        <p className="text-xs text-neutral-500 mb-4">
          {unassembledCount === 0
            ? "No approved brief is currently waiting to be assembled."
            : `${unassembledCount ?? 0} approved brief${unassembledCount === 1 ? "" : "s"} not yet assembled — either the assembly stage has not run, or entity resolution held them as ambiguous.`}{" "}
          <TextLink href="/admin/engine/entity-resolutions?decision=ambiguous">Check ambiguous resolutions</TextLink>
        </p>
      )}

      {!anyError && visible.length === 0 ? (
        <EmptyState
          title={activeMedia ? "Nothing matches this filter" : "No drafts assembled yet"}
          description="Drafts appear here after the assembly stage runs against briefs a human has already approved."
        />
      ) : (
        !anyError && (
          <div className="flex flex-col gap-3">
            {visible.map(({ brief, contentId, content, requirement, readiness }) => (
              <Card key={brief.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900">{brief.proposed_title}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {brief.content_type ? humanise(brief.content_type) : "Type not set"}
                      {brief.category_slug ? ` · ${brief.category_slug}` : ""}
                      {brief.search_intent ? ` · ${humanise(brief.search_intent)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <BriefKindBadge kind={brief.brief_kind} />
                    <FreshnessSensitivityBadge value={brief.freshness_sensitivity} />
                    {brief.priority !== null && <Badge tone="neutral">priority {brief.priority}</Badge>}
                    <StateBadge state={brief.state} />
                    {content ? (
                      <Badge tone={content.status === "published" ? "green" : "neutral"}>
                        Content: {humanise(content.status)}
                      </Badge>
                    ) : (
                      <Badge tone="red">Draft record missing</Badge>
                    )}
                  </div>
                </div>

                {/* The media gate, stated as a blocker rather than a footnote —
                    a draft that cannot be published is a different thing from
                    one that is merely unwritten, and the editor should know
                    which before starting. */}
                <div
                  className={`mt-3 rounded border p-3 ${
                    readiness.ready ? "border-green-200 bg-green-50" : "border-amber-300 bg-amber-50"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={readiness.ready ? "green" : "amber"}>
                      {readiness.ready ? "Passes the media gate" : "Blocked on media"}
                    </Badge>
                    {requirement ? (
                      <Badge tone="neutral">Sourcing: {humanise(requirement.sourcing_status)}</Badge>
                    ) : (
                      <Badge tone="neutral">No media requirement row</Badge>
                    )}
                  </div>
                  {!readiness.ready && <p className="text-xs text-neutral-800 mt-2">{readiness.reason}</p>}
                  {requirement?.notes && <p className="text-xs text-neutral-600 mt-1">{requirement.notes}</p>}
                  {brief.media_requirement_note && (
                    <p className="text-xs text-neutral-600 mt-1">Brief note: {brief.media_requirement_note}</p>
                  )}
                </div>

                <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3">
                  <p className="text-xs font-semibold text-neutral-900">Why the engine proposed this</p>
                  <p className="text-xs text-neutral-700 mt-1">{brief.rationale}</p>
                </div>

                {brief.primary_question && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-neutral-900">Primary question</p>
                    <p className="text-sm text-neutral-700 mt-0.5">{brief.primary_question}</p>
                  </div>
                )}

                {/* The hard split. Rendered as two visually different things so
                    a rumour can never be skim-read as an established fact
                    while someone is writing from it. */}
                <div className="grid gap-3 md:grid-cols-2 mt-3">
                  <div className="rounded border border-green-200 bg-green-50 p-3">
                    <p className="text-xs font-semibold text-neutral-900">
                      Verified facts ({brief.verified_facts.length})
                    </p>
                    {brief.verified_facts.length === 0 ? (
                      <p className="text-xs text-neutral-600 mt-1">
                        Nothing is primary-confirmed. Every claim in this draft must be written as an attributed claim,
                        not as fact.
                      </p>
                    ) : (
                      <ul className="list-disc list-inside text-xs text-neutral-800 mt-1 space-y-1">
                        {brief.verified_facts.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div
                    className={`rounded border p-3 ${
                      brief.uncertainties.length > 0 ? "border-red-300 bg-red-50" : "border-neutral-200 bg-neutral-50"
                    }`}
                  >
                    <p className="text-xs font-semibold text-neutral-900">
                      Unverified claims ({brief.uncertainties.length})
                    </p>
                    {brief.uncertainties.length === 0 ? (
                      <p className="text-xs text-neutral-600 mt-1">No recorded uncertainties.</p>
                    ) : (
                      <ul className="list-disc list-inside text-xs text-red-900 mt-1 space-y-1">
                        {brief.uncertainties.map((u, i) => (
                          <li key={i}>{u}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {/* Suggested internal links are the brief's own related slugs.
                    They are suggestions recorded at brief time, not verified
                    link targets — a slug listed here may since have changed or
                    may point at something still unpublished, so it is labelled
                    as a suggestion rather than rendered as a link. */}
                {(brief.related_content_slugs.length > 0 || brief.related_product_slugs.length > 0) && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-neutral-900">Suggested internal links</p>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                      Recorded when the brief was written. Confirm each target still exists and is published before
                      linking it.
                    </p>
                    {brief.related_content_slugs.length > 0 && (
                      <p className="text-xs text-neutral-700 mt-1">
                        Content: {brief.related_content_slugs.join(", ")}
                      </p>
                    )}
                    {brief.related_product_slugs.length > 0 && (
                      <p className="text-xs text-neutral-700 mt-0.5">
                        Products: {brief.related_product_slugs.join(", ")}
                      </p>
                    )}
                  </div>
                )}

                {brief.suggested_structure.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-neutral-700">
                      Suggested structure ({brief.suggested_structure.length})
                    </summary>
                    <ol className="list-decimal list-inside text-xs text-neutral-700 mt-2 space-y-0.5">
                      {brief.suggested_structure.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  </details>
                )}

                {brief.source_urls.length > 0 ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-neutral-700">
                      Sources ({brief.source_urls.length})
                    </summary>
                    <ul className="flex flex-col gap-1 mt-2">
                      {brief.source_urls.map((u) => (
                        <li key={u} className="text-xs break-all">
                          <a
                            href={u}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent underline hover:text-neutral-900"
                          >
                            {u}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <p className="text-xs text-amber-800 mt-3">
                    No source URLs recorded on this brief. Treat the draft as unsourced.
                  </p>
                )}

                {brief.assembly_note && (
                  <p className="text-xs text-neutral-600 mt-3">Assembly note: {brief.assembly_note}</p>
                )}
                {brief.review_note && (
                  <p className="text-xs text-neutral-600 mt-1">Review note: {brief.review_note}</p>
                )}
                {brief.state_reason && (
                  <p className="text-xs text-neutral-500 mt-1">State reason: {brief.state_reason}</p>
                )}

                <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-neutral-100">
                  {content ? (
                    <TextLink href={`/admin/content/${contentId}`}>Open the draft to edit it</TextLink>
                  ) : (
                    // The brief points at a content row that is not readable.
                    // Said plainly, because "no link" would otherwise look like
                    // an ordinary missing field.
                    <span className="text-xs text-red-700">
                      The brief references a content record that could not be read (id {contentId}). It may have been
                      deleted.
                    </span>
                  )}
                  <span className="text-[11px] text-neutral-400">
                    Assembled {formatDateTime(brief.assembled_at)}
                    {content ? ` · content last updated ${formatDateTime(content.updated_at)}` : ""}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )
      )}
    </div>
  );
}
