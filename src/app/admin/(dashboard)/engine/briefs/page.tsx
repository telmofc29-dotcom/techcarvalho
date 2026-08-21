import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Badge, TextLink, EmptyState, QueryErrorBanner } from "@/components/admin/ui";
import type { BriefState } from "@/lib/engine/types";
import { EngineTabs, StateBadge, formatDateTime, humanise } from "../shared";

// Pipeline order, weakest-to-strongest. Rendering as columns/sections in this
// fixed order (rather than by row count) keeps the board readable as work
// moves along it.
const PIPELINE_ORDER: BriefState[] = [
  "planned",
  "drafting",
  "media_check",
  "review_eligible",
  "published",
  "blocked",
  "rejected",
  "error",
];

type BriefRow = {
  id: string;
  proposed_title: string;
  proposed_slug: string | null;
  content_type: string | null;
  search_intent: string | null;
  primary_query: string | null;
  category_slug: string | null;
  rationale: string;
  related_product_slugs: string[];
  related_content_slugs: string[];
  media_requirement_note: string | null;
  state: BriefState;
  state_reason: string | null;
  content_id: string | null;
  created_at: string;
};

export default async function EngineBriefsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("engine_briefs")
    .select(
      "id, proposed_title, proposed_slug, content_type, search_intent, primary_query, category_slug, rationale, related_product_slugs, related_content_slugs, media_requirement_note, state, state_reason, content_id, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as BriefRow[];
  const byState = new Map<BriefState, BriefRow[]>();
  for (const b of rows) {
    const list = byState.get(b.state) ?? [];
    list.push(b);
    byState.set(b.state, list);
  }

  return (
    <div>
      <PageHeader
        title="Content pipeline"
        description="Structured briefs proposed by the engine. A brief is a proposal — a human turns it into content through the normal editorial workflow."
      />
      <EngineTabs current="/admin/engine/briefs" />

      <Card className="p-4 mb-6 border-blue-200 bg-blue-50">
        <p className="text-sm font-medium text-neutral-900">Briefs are proposals, not drafts</p>
        <p className="text-xs text-neutral-700 mt-1">
          Nothing on this page is published or publishable on its own. A brief only becomes real content when someone
          creates a content record from it, and that record still has to pass the media-first gate like any other.
        </p>
      </Card>

      {error && <QueryErrorBanner message={`Failed to load briefs: ${error.message}`} />}

      {!error && rows.length === 0 ? (
        <EmptyState
          title="No briefs yet"
          description="Briefs are created from discoveries and opportunities once the planning step runs."
        />
      ) : (
        !error && (
          <div className="flex flex-col gap-6">
            {PIPELINE_ORDER.filter((s) => (byState.get(s) ?? []).length > 0).map((s) => {
              const list = byState.get(s) ?? [];
              return (
                <section key={s}>
                  <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-sm font-semibold text-neutral-900">{humanise(s)}</h2>
                    <Badge tone="neutral">{list.length}</Badge>
                  </div>
                  <div className="flex flex-col gap-2">
                    {list.map((b) => (
                      <Card key={b.id} className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-neutral-900">{b.proposed_title}</p>
                            <p className="text-xs text-neutral-500 mt-0.5">
                              {b.content_type ? humanise(b.content_type) : "Type not set"}
                              {b.category_slug ? ` · ${b.category_slug}` : ""}
                              {b.search_intent ? ` · ${humanise(b.search_intent)}` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <StateBadge state={b.state} />
                          </div>
                        </div>

                        <p className="text-sm text-neutral-700 mt-2">{b.rationale}</p>

                        {b.primary_query && (
                          <p className="text-xs text-neutral-500 mt-2">Target query: {b.primary_query}</p>
                        )}
                        {b.proposed_slug && (
                          <p className="text-xs text-neutral-500 mt-1">Proposed slug: {b.proposed_slug}</p>
                        )}

                        {(b.related_product_slugs.length > 0 || b.related_content_slugs.length > 0) && (
                          <div className="mt-2 text-xs text-neutral-600">
                            {b.related_product_slugs.length > 0 && (
                              <p>Related products: {b.related_product_slugs.join(", ")}</p>
                            )}
                            {b.related_content_slugs.length > 0 && (
                              <p>Related content: {b.related_content_slugs.join(", ")}</p>
                            )}
                          </div>
                        )}

                        {b.media_requirement_note && (
                          <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2">
                            <p className="text-xs font-semibold text-neutral-900">Media requirement</p>
                            <p className="text-xs text-neutral-700 mt-0.5">{b.media_requirement_note}</p>
                          </div>
                        )}

                        {b.state_reason && (
                          <p className="text-xs text-neutral-500 mt-2">State reason: {b.state_reason}</p>
                        )}

                        <div className="flex flex-wrap items-center gap-3 mt-3">
                          {b.content_id ? (
                            <TextLink href={`/admin/content/${b.content_id}`}>Open the content record</TextLink>
                          ) : (
                            <span className="text-xs text-neutral-400">No content record created from this yet.</span>
                          )}
                          <span className="text-[11px] text-neutral-400">Created {formatDateTime(b.created_at)}</span>
                        </div>
                      </Card>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
