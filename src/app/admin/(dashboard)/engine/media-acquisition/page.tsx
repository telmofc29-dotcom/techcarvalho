import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader,
  Card,
  Badge,
  Field,
  TextInput,
  TextLink,
  EmptyState,
  QueryErrorBanner,
} from "@/components/admin/ui";
import type { EngineSource } from "@/lib/engine/types";
import { decideMediaCandidate } from "../actions";
import { CandidateStateBadge, EngineTabs, MediaRightsBadge, formatDateTime, humanise } from "../shared";

// The media acquisition pipeline:
//   discovered -> rights_review -> approved -> ingested -> associated
//                              \-> rejected
//
// This page's job is to make one thing impossible to misread: finding an image
// is not permission to use it. Every candidate arrives needing review, approval
// means only "cleared for a human to ingest", and no control here writes a
// media_assets row, associates an asset, or flips a source's republication
// flag. The three source permissions are rendered as three separate statements
// for the same reason.

type CandidateRow = {
  id: string;
  media_requirement_id: string | null;
  product_id: string | null;
  content_id: string | null;
  source_organisation: string | null;
  source_url: string | null;
  asset_url: string | null;
  asset_type: string | null;
  width: number | null;
  height: number | null;
  potential_licence: string | null;
  attribution_required: boolean;
  rights_status: string;
  requires_human_review: boolean;
  confidence: number;
  state: string;
  state_reason: string | null;
  created_at: string;
};

type RequirementRow = {
  id: string;
  product_id: string | null;
  content_id: string | null;
  sourcing_status: string;
  target_source_type: string | null;
  notes: string | null;
};

const PIPELINE_ORDER = ["rights_review", "discovered", "approved", "ingested", "associated", "rejected"] as const;

const STATE_BLURB: Record<string, string> = {
  rights_review: "Awaiting a human rights decision. Nothing may proceed past here automatically.",
  discovered: "Found, not yet queued for review.",
  approved: "Cleared for ingest by a human. NOT yet ingested and NOT in use.",
  ingested: "Copied into the Media library, not yet attached to a record.",
  associated: "Attached to a product or article and in use.",
  rejected: "Ruled out. Kept for the audit trail rather than deleted.",
};

function CandidateCard({ c, showDecision }: { c: CandidateRow; showDecision: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-neutral-900">{c.source_organisation ?? "Unknown source"}</p>
          {c.asset_url && <p className="text-xs text-neutral-500 break-all mt-0.5">{c.asset_url}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CandidateStateBadge state={c.state} />
          <MediaRightsBadge status={c.rights_status as EngineSource["media_rights_status"]} />
          {c.requires_human_review && <Badge tone="amber">Human review required</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-3 text-xs text-neutral-600">
        <p>Asset type: {c.asset_type ? humanise(c.asset_type) : "—"}</p>
        <p>
          Dimensions:{" "}
          {c.width && c.height ? `${c.width} x ${c.height}` : "unknown"}
        </p>
        <p>Potential licence: {c.potential_licence ?? "not identified"}</p>
        <p>Attribution required: {c.attribution_required ? "Yes" : "Not known"}</p>
        <p>Confidence: {c.confidence.toFixed(2)}</p>
        <p>Discovered: {formatDateTime(c.created_at)}</p>
      </div>

      {c.source_url && <p className="text-xs text-neutral-600 mt-2 break-all">Source page: {c.source_url}</p>}
      {c.state_reason && <p className="text-xs text-neutral-600 mt-1">Note: {c.state_reason}</p>}

      <div className="flex flex-wrap gap-3 mt-2 text-xs">
        {c.product_id && <TextLink href={`/admin/products/${c.product_id}`}>View product</TextLink>}
        {c.content_id && <TextLink href={`/admin/content/${c.content_id}`}>View content</TextLink>}
      </div>

      {showDecision && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-neutral-900">Rights decision</p>
          <p className="text-[11px] text-neutral-700 mt-0.5 mb-2">
            Approving records that the terms have been read and permit our use. It does <strong>not</strong> download
            the asset, create a Media record, or attach it to anything — those remain separate manual steps.
          </p>
          <form action={decideMediaCandidate} className="flex flex-col gap-2 max-w-lg">
            <input type="hidden" name="id" value={c.id} />
            <Field label="Reason / terms reference" htmlFor={`reason-${c.id}`}>
              <TextInput
                id={`reason-${c.id}`}
                name="state_reason"
                placeholder="e.g. Press terms permit editorial use with credit"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                name="decision"
                value="approved"
                className="rounded px-3 py-1.5 text-xs font-medium bg-neutral-900 text-white hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
              >
                Approve for ingest
              </button>
              <button
                type="submit"
                name="decision"
                value="rejected"
                className="rounded px-3 py-1.5 text-xs font-medium border border-red-300 text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
              >
                Reject
              </button>
            </div>
          </form>
        </div>
      )}
    </Card>
  );
}

export default async function MediaAcquisitionPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [
    { data: candidates, error: candidatesError },
    { data: requirements, error: requirementsError },
    { data: sources, error: sourcesError },
    { count: unlockedCount, error: unlockedError },
  ] = await Promise.all([
    supabase
      .from("engine_media_candidates")
      .select(
        "id, media_requirement_id, product_id, content_id, source_organisation, source_url, asset_url, " +
          "asset_type, width, height, potential_licence, attribution_required, rights_status, " +
          "requires_human_review, confidence, state, state_reason, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("media_requirements")
      .select("id, product_id, content_id, sourcing_status, target_source_type, notes")
      .in("sourcing_status", ["needed", "sourcing"]),
    supabase
      .from("engine_sources")
      .select(
        "id, organisation, media_browsing_permitted, media_republication_permitted, media_rights_status, " +
          "discovery_permitted, editorial_use_only, registration_required, last_reviewed_at, terms_url"
      )
      .order("organisation"),
    supabase.from("media_requirements").select("id", { count: "exact", head: true }).eq("sourcing_status", "approved"),
  ]);

  const rows = (candidates ?? []) as unknown as CandidateRow[];
  const reqs = (requirements ?? []) as unknown as RequirementRow[];

  const productIds = reqs.filter((r) => r.product_id).map((r) => r.product_id as string);
  const contentIds = reqs.filter((r) => r.content_id).map((r) => r.content_id as string);

  const [{ data: products, error: productsError }, { data: contentRows, error: contentError }] = await Promise.all([
    productIds.length > 0
      ? supabase.from("products").select("id, name").in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    contentIds.length > 0
      ? supabase.from("content_items").select("id, title").in("id", contentIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[], error: null }),
  ]);

  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));
  const contentTitleById = new Map((contentRows ?? []).map((c) => [c.id, c.title]));

  const candidateCountByRequirement = new Map<string, number>();
  for (const c of rows) {
    if (!c.media_requirement_id) continue;
    candidateCountByRequirement.set(
      c.media_requirement_id,
      (candidateCountByRequirement.get(c.media_requirement_id) ?? 0) + 1
    );
  }

  const byState = new Map<string, CandidateRow[]>();
  for (const c of rows) {
    const list = byState.get(c.state) ?? [];
    list.push(c);
    byState.set(c.state, list);
  }

  const reviewQueue = byState.get("rights_review") ?? [];

  const sourceRows = (sources ?? []) as unknown as (Pick<
    EngineSource,
    | "id"
    | "organisation"
    | "media_browsing_permitted"
    | "media_republication_permitted"
    | "media_rights_status"
    | "discovery_permitted"
    | "editorial_use_only"
    | "registration_required"
    | "last_reviewed_at"
    | "terms_url"
  >)[];

  const republicationApproved = sourceRows.filter((s) => s.media_republication_permitted);
  const blockedSources = sourceRows.filter(
    (s) => s.media_rights_status === "prohibited" || s.media_rights_status === "no_source_found"
  );

  const anyError =
    candidatesError || requirementsError || sourcesError || productsError || contentError || unlockedError;

  return (
    <div>
      <PageHeader
        title="Media acquisition"
        description="Finding candidate imagery for records blocked on media — and keeping 'we found it' strictly separate from 'we may use it'."
      />
      <EngineTabs current="/admin/engine/media-acquisition" />

      <Card className="p-4 mb-6 border-amber-200 bg-amber-50">
        <p className="text-sm font-medium text-neutral-900">Discovery is not permission</p>
        <p className="text-xs text-neutral-700 mt-1">
          A candidate on this page is an image the engine <em>found</em>. That is all it is. Nothing may move past
          rights review automatically, approval means only that a human read the terms and cleared it for ingest, and
          approving still does not download, store, or attach anything. An image being publicly reachable is never
          evidence that we may republish it.
        </p>
      </Card>

      {candidatesError && <QueryErrorBanner message={`Failed to load media candidates: ${candidatesError.message}`} />}
      {requirementsError && (
        <QueryErrorBanner message={`Failed to load media requirements: ${requirementsError.message}`} />
      )}
      {sourcesError && <QueryErrorBanner message={`Failed to load source registry: ${sourcesError.message}`} />}
      {productsError && <QueryErrorBanner message={`Failed to load products: ${productsError.message}`} />}
      {contentError && <QueryErrorBanner message={`Failed to load content: ${contentError.message}`} />}
      {unlockedError && <QueryErrorBanner message={`Failed to count unlocked records: ${unlockedError.message}`} />}

      {!anyError && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Open requirements</p>
              <p className="mt-1 text-lg font-semibold text-neutral-900">{reqs.length}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Candidates found</p>
              <p className="mt-1 text-lg font-semibold text-neutral-900">{rows.length}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Awaiting rights review</p>
              <p className="mt-1 text-lg font-semibold text-neutral-900">{reviewQueue.length}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Records unlocked</p>
              <p className="mt-1 text-lg font-semibold text-neutral-900">{unlockedCount ?? 0}</p>
            </Card>
          </div>

          {/* Rights review queue first — it is the only part of this page that
              needs a human right now. */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-neutral-900 mb-1">Rights review queue</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Candidates waiting on a human decision. Approving clears an asset for ingest; it does not ingest it.
            </p>
            {reviewQueue.length === 0 ? (
              <EmptyState
                title="Nothing awaiting rights review"
                description="Candidates appear here as the acquisition pass finds them."
              />
            ) : (
              <div className="flex flex-col gap-3">
                {reviewQueue.map((c) => (
                  <CandidateCard key={c.id} c={c} showDecision />
                ))}
              </div>
            )}
          </section>

          <section className="mb-8">
            <h2 className="text-sm font-semibold text-neutral-900 mb-1">Open media requirements</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Records still blocked on imagery, and how many candidates have been found for each.
            </p>
            {reqs.length === 0 ? (
              <EmptyState title="No open media requirements" description="Every requirement has been resolved." />
            ) : (
              <div className="flex flex-col gap-2">
                {reqs.map((r) => {
                  const label = r.product_id
                    ? (productNameById.get(r.product_id) ?? "(product)")
                    : r.content_id
                      ? (contentTitleById.get(r.content_id) ?? "(content)")
                      : "(unknown record)";
                  const count = candidateCountByRequirement.get(r.id) ?? 0;
                  return (
                    <Card key={r.id} className="p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-neutral-900">
                            {r.product_id ? (
                              <TextLink href={`/admin/products/${r.product_id}`}>{label}</TextLink>
                            ) : r.content_id ? (
                              <TextLink href={`/admin/content/${r.content_id}`}>{label}</TextLink>
                            ) : (
                              label
                            )}
                          </p>
                          {r.notes && <p className="text-xs text-neutral-500 mt-0.5">{r.notes}</p>}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="neutral">{humanise(r.sourcing_status)}</Badge>
                          {r.target_source_type && <Badge tone="neutral">{humanise(r.target_source_type)}</Badge>}
                          <Badge tone={count > 0 ? "blue" : "amber"}>
                            {count} candidate{count === 1 ? "" : "s"}
                          </Badge>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          <section className="mb-8">
            <h2 className="text-sm font-semibold text-neutral-900 mb-1">Candidates by pipeline state</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Nothing reaches <strong>associated</strong> without passing rights review and being ingested by a human.
            </p>
            {rows.length === 0 ? (
              <EmptyState
                title="No media candidates yet"
                description="The acquisition pass records candidates here. Each one arrives requiring rights review."
              />
            ) : (
              <div className="flex flex-col gap-4">
                {PIPELINE_ORDER.filter((s) => (byState.get(s) ?? []).length > 0).map((state) => {
                  const list = byState.get(state) ?? [];
                  return (
                    <div key={state}>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <CandidateStateBadge state={state} />
                        <span className="text-xs text-neutral-500">
                          {list.length} candidate{list.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-500 mb-2">{STATE_BLURB[state]}</p>
                      <div className="flex flex-col gap-2">
                        {list.map((c) => (
                          <CandidateCard key={c.id} c={c} showDecision={false} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-neutral-900 mb-1">Source permissions</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Three independent permissions. Each is a separate fact about a source; none implies another.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <Card className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Republication approved
                </p>
                <p className="mt-1 text-lg font-semibold text-neutral-900">{republicationApproved.length}</p>
                <p className="text-xs text-neutral-600 mt-1">
                  {republicationApproved.length === 0
                    ? "No source has been cleared to republish imagery."
                    : republicationApproved.map((s) => s.organisation).join(", ")}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Blocked / no source</p>
                <p className="mt-1 text-lg font-semibold text-neutral-900">{blockedSources.length}</p>
                <p className="text-xs text-neutral-600 mt-1">
                  {blockedSources.length === 0
                    ? "None marked prohibited or unsourceable."
                    : blockedSources.map((s) => s.organisation).join(", ")}
                </p>
              </Card>
            </div>

            {sourceRows.length === 0 ? (
              <EmptyState title="No sources registered" description="Add sources in the Source registry." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[720px]">
                  <thead>
                    <tr className="text-left text-neutral-500">
                      <th className="pb-2 font-medium">Source</th>
                      <th className="pb-2 font-medium">Read facts</th>
                      <th className="pb-2 font-medium">Browse media</th>
                      <th className="pb-2 font-medium">Republish media</th>
                      <th className="pb-2 font-medium">Rights status</th>
                      <th className="pb-2 font-medium">Last reviewed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceRows.map((s) => (
                      <tr key={s.id} className="border-t border-neutral-100">
                        <td className="py-2 pr-3 text-neutral-900">
                          {s.organisation}
                          {s.editorial_use_only && (
                            <span className="ml-2 text-[11px] text-neutral-500">editorial only</span>
                          )}
                          {s.registration_required && (
                            <span className="ml-2 text-[11px] text-neutral-500">registration required</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge tone={s.discovery_permitted ? "green" : "neutral"}>
                            {s.discovery_permitted ? "Yes" : "No"}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge tone={s.media_browsing_permitted ? "green" : "neutral"}>
                            {s.media_browsing_permitted ? "Yes" : "No"}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge tone={s.media_republication_permitted ? "green" : "amber"}>
                            {s.media_republication_permitted ? "Yes" : "NOT permitted"}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3">
                          <MediaRightsBadge status={s.media_rights_status} />
                        </td>
                        <td className="py-2 text-neutral-600">{formatDateTime(s.last_reviewed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
