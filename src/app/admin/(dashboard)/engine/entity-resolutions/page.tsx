import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Badge, TextLink, EmptyState, QueryErrorBanner } from "@/components/admin/ui";
import type { Database, EngineResolutionDecision } from "@/lib/types/database";
import {
  EngineTabs,
  MatchScore,
  ResolutionDecisionBadge,
  formatDateTime,
  humanise,
} from "../shared";

// Phase 6 — entity resolution audit.
//
// Exists to answer one question that is otherwise unanswerable: "why didn't
// this create a record?" Every match decision is logged, including the ones
// that changed nothing, so a wrong merge can be found and reversed and a
// silently-dropped topic can be found at all.
//
// 'ambiguous' is the decision that matters most and is therefore the default
// view. An ambiguous resolution means the engine stopped: it neither assembled
// a draft nor filed an update proposal, and the brief is sitting approved and
// unassembled until a person decides whether the topic is the same thing as
// the near-match or a different one. Nothing else in the system will move it.
//
// Read-only by design. Settling an ambiguity is an editorial act performed on
// the brief or the target record, not a status toggle on an audit log.

const DECISION_FILTERS: EngineResolutionDecision[] = [
  "ambiguous",
  "matched_existing",
  "new_entity",
  "ignored",
];

// supabase-js infers row shapes only from a single string literal, and this
// column list is too long for one — so the shape is taken from the schema type
// instead of being restated, and a renamed column fails at compile time.
const RESOLUTION_COLUMNS =
  "id, discovery_id, candidate_name, normalised_name, matched_product_id, matched_content_id, " +
  "match_score, decision, explanation, created_at";

type ResolutionRow = Database["public"]["Tables"]["engine_entity_resolutions"]["Row"];

const DECISION_MEANING: Record<EngineResolutionDecision, string> = {
  ambiguous:
    "The engine could not tell whether this is something already covered. It did not assemble a draft and did not file an update proposal — a human has to decide.",
  matched_existing:
    "Treated as something already covered. An update proposal was filed against the matched record instead of a second page being created.",
  new_entity: "Treated as new. This is the path that leads to a draft being assembled.",
  ignored: "Deliberately skipped. No draft, no proposal, no record created.",
};

export default async function EngineEntityResolutionsPage({
  searchParams,
}: {
  searchParams: Promise<{ decision?: string }>;
}) {
  await requireAdmin();
  const { decision } = await searchParams;
  const supabase = await createClient();

  const activeDecision = DECISION_FILTERS.find((d) => d === decision) ?? "ambiguous";

  const { data: resolutionData, error: resolutionsError } = await supabase
    .from("engine_entity_resolutions")
    .select(RESOLUTION_COLUMNS)
    .eq("decision", activeDecision)
    .order("created_at", { ascending: false })
    .limit(200);

  const resolutions = (resolutionData ?? []) as unknown as ResolutionRow[];

  const productIds = resolutions.map((r) => r.matched_product_id).filter((id): id is string => !!id);
  const contentIds = resolutions.map((r) => r.matched_content_id).filter((id): id is string => !!id);
  const discoveryIds = resolutions.map((r) => r.discovery_id).filter((id): id is string => !!id);

  const [
    { data: productRows, error: productsError },
    { data: contentRows, error: contentError },
    { data: discoveryRows, error: discoveriesError },
    { data: decisionRows, error: countsError },
  ] = await Promise.all([
    productIds.length > 0
      ? supabase.from("products").select("id, name, is_published").in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; name: string; is_published: boolean }[], error: null }),
    contentIds.length > 0
      ? supabase.from("content_items").select("id, title, status").in("id", contentIds)
      : Promise.resolve({ data: [] as { id: string; title: string; status: string }[], error: null }),
    discoveryIds.length > 0
      ? supabase.from("engine_discoveries").select("id, title, state, claim_status").in("id", discoveryIds)
      : Promise.resolve({
          data: [] as { id: string; title: string; state: string; claim_status: string }[],
          error: null,
        }),
    supabase.from("engine_entity_resolutions").select("decision"),
  ]);

  const productById = new Map((productRows ?? []).map((p) => [p.id, p]));
  const contentById = new Map((contentRows ?? []).map((c) => [c.id, c]));
  const discoveryById = new Map((discoveryRows ?? []).map((d) => [d.id, d]));

  const counts = new Map<string, number>();
  for (const r of (decisionRows ?? []) as { decision: string }[]) {
    counts.set(r.decision, (counts.get(r.decision) ?? 0) + 1);
  }

  const anyError = resolutionsError || productsError || contentError || discoveriesError;

  return (
    <div>
      <PageHeader
        title="Entity resolution"
        description="Every match decision the engine made, including the ones that created nothing. This is where 'why didn't this produce a record?' is answered."
      />
      <EngineTabs current="/admin/engine/entity-resolutions" />

      <Card className="p-4 mb-6 border-blue-200 bg-blue-50">
        <p className="text-sm font-medium text-neutral-900">Ambiguous decisions are the ones needing a human</p>
        <p className="text-xs text-neutral-700 mt-1">
          When the engine cannot tell whether a topic is something already covered, it stops rather than guessing —
          guessing wrong either duplicates a page or silently merges two different products. Those items go nowhere on
          their own. Settle them by looking at the near-match: if it is the same thing, edit that record; if it is not,
          the brief can be re-approved for assembly. This log is read-only; it records what happened rather than being
          somewhere to change it.
        </p>
      </Card>

      <div className="flex flex-wrap gap-2 mb-2">
        {DECISION_FILTERS.map((d) => (
          <a
            key={d}
            href={`/admin/engine/entity-resolutions?decision=${d}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              activeDecision === d ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
            }`}
          >
            {humanise(d)}
            {!countsError && counts.has(d) ? ` (${counts.get(d)})` : ""}
          </a>
        ))}
      </div>
      <p className="text-xs text-neutral-500 mb-4">{DECISION_MEANING[activeDecision]}</p>

      {resolutionsError && (
        <QueryErrorBanner message={`Failed to load entity resolutions: ${resolutionsError.message}`} />
      )}
      {productsError && <QueryErrorBanner message={`Failed to load matched products: ${productsError.message}`} />}
      {contentError && <QueryErrorBanner message={`Failed to load matched articles: ${contentError.message}`} />}
      {discoveriesError && (
        <QueryErrorBanner message={`Failed to load originating discoveries: ${discoveriesError.message}`} />
      )}
      {countsError && <QueryErrorBanner message={`Failed to load decision counts: ${countsError.message}`} />}

      {!anyError && resolutions.length === 0 ? (
        <EmptyState
          title={`No ${humanise(activeDecision).toLowerCase()} decisions`}
          description="Resolutions are logged whenever the draft-assembly or update-proposal stage runs."
        />
      ) : (
        !anyError && (
          <div className="flex flex-col gap-3">
            {resolutions.map((r) => {
              const product = r.matched_product_id ? (productById.get(r.matched_product_id) ?? null) : null;
              const content = r.matched_content_id ? (contentById.get(r.matched_content_id) ?? null) : null;
              const discovery = r.discovery_id ? (discoveryById.get(r.discovery_id) ?? null) : null;

              return (
                <Card key={r.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-900">{r.candidate_name}</p>
                      <p className="text-xs text-neutral-500 mt-0.5">Normalised as: {r.normalised_name}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <ResolutionDecisionBadge decision={r.decision} />
                      <MatchScore score={r.match_score} />
                    </div>
                  </div>

                  <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3">
                    <p className="text-xs font-semibold text-neutral-900">What the engine decided, and why</p>
                    <p className="text-xs text-neutral-700 mt-1">{r.explanation}</p>
                  </div>

                  <div className="mt-3 text-xs">
                    <p className="font-semibold text-neutral-900">Matched against</p>
                    {product ? (
                      <p className="mt-1 flex flex-wrap items-center gap-2">
                        <TextLink href={`/admin/products/${product.id}`}>{product.name}</TextLink>
                        <Badge tone={product.is_published ? "green" : "neutral"}>
                          {product.is_published ? "Published product" : "Unpublished product"}
                        </Badge>
                      </p>
                    ) : content ? (
                      <p className="mt-1 flex flex-wrap items-center gap-2">
                        <TextLink href={`/admin/content/${content.id}`}>{content.title}</TextLink>
                        <Badge tone={content.status === "published" ? "green" : "neutral"}>
                          Article: {humanise(content.status)}
                        </Badge>
                      </p>
                    ) : r.matched_product_id || r.matched_content_id ? (
                      // A recorded match whose target no longer reads back —
                      // said explicitly, since "nothing matched" and "the match
                      // is gone" lead to opposite conclusions.
                      <p className="mt-1 text-red-700">
                        A match was recorded against{" "}
                        {r.matched_product_id ? `product ${r.matched_product_id}` : `content ${r.matched_content_id}`},
                        but that record could not be read. It may have been deleted since.
                      </p>
                    ) : (
                      <p className="mt-1 text-neutral-600">
                        No existing record was matched
                        {r.decision === "ambiguous"
                          ? " — the engine found the candidate close to something without being confident enough to say it is the same thing."
                          : "."}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-neutral-400">
                    <span>Logged {formatDateTime(r.created_at)}</span>
                    {discovery ? (
                      <span>
                        From discovery: {discovery.title} ({humanise(discovery.state)} ·{" "}
                        {humanise(discovery.claim_status)})
                      </span>
                    ) : r.discovery_id ? (
                      <span>Originating discovery could not be read (id {r.discovery_id}).</span>
                    ) : (
                      <span>No originating discovery recorded.</span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
