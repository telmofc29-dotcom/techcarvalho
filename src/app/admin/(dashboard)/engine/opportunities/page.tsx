import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Badge, EmptyState, QueryErrorBanner } from "@/components/admin/ui";
import { byScoreDescending } from "@/lib/engine/opportunity";
import type { EngineOpportunity } from "@/lib/engine/types";
import { EngineTabs, formatDateTime, humanise } from "../shared";

// Readable rendering of the stored `inputs` jsonb. The engine keeps the inputs
// alongside the score specifically so a recommendation can be audited rather
// than taken on trust, so this page shows them rather than hiding them behind
// the number.
function InputsGrid({ inputs }: { inputs: Record<string, unknown> }) {
  const entries = Object.entries(inputs ?? {});
  if (entries.length === 0) {
    return <p className="text-xs text-neutral-500">No inputs recorded.</p>;
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="text-xs">
          <span className="text-neutral-500">{humanise(key)}: </span>
          <span className="text-neutral-900 tabular-nums">
            {value === null || value === undefined ? "—" : String(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function scoreTone(score: number | null): "green" | "amber" | "neutral" {
  if (score === null) return "neutral";
  if (score >= 50) return "green";
  if (score >= 25) return "amber";
  return "neutral";
}

export default async function EngineOpportunitiesPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("engine_opportunities")
    .select("id, subject_type, subject_key, label, score, inputs, explanation, computed_at")
    .limit(200);

  // Sorted in JS rather than SQL so the "unscored sorts last, never as zero"
  // rule lives in one place (byScoreDescending) and can't drift between the
  // query and the scoring module.
  const rows = ([...((data ?? []) as EngineOpportunity[])]).sort(byScoreDescending);
  const unscored = rows.filter((r) => r.score === null).length;

  return (
    <div>
      <PageHeader
        title="Opportunities"
        description="What to create or update next, ranked by measured visitor demand rather than by whichever story is newest."
      />
      <EngineTabs current="/admin/engine/opportunities" />

      <Card className="p-4 mb-6 border-blue-200 bg-blue-50">
        <p className="text-sm font-medium text-neutral-900">Reading these scores</p>
        <p className="text-xs text-neutral-700 mt-1">
          A score of <strong>&ldquo;Not scored&rdquo;</strong> means there was not enough measured demand to say
          anything honest — it does <strong>not</strong> mean zero opportunity. Unscored subjects sort last rather than
          being treated as a zero.
        </p>
      </Card>

      {error && <QueryErrorBanner message={`Failed to load opportunities: ${error.message}`} />}

      {!error && rows.length === 0 ? (
        <EmptyState
          title="No opportunities computed yet"
          description="Opportunity scoring runs on a schedule once the engine and opportunity scoring are enabled."
        />
      ) : (
        !error && (
          <>
            {unscored > 0 && (
              <p className="text-xs text-neutral-500 mb-3">
                {unscored} subject{unscored === 1 ? "" : "s"} could not be scored due to insufficient measured demand.
              </p>
            )}
            <div className="flex flex-col gap-3">
              {rows.map((o) => (
                <Card key={o.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-900">{o.label}</p>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {humanise(o.subject_type)} · {o.subject_key}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {o.score === null ? (
                        <Badge tone="neutral">Not scored</Badge>
                      ) : (
                        <Badge tone={scoreTone(o.score)}>{Number(o.score).toFixed(1)} / 100</Badge>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3">
                    <p className="text-xs font-semibold text-neutral-900">Why</p>
                    <p className="text-xs text-neutral-700 mt-1">{o.explanation}</p>
                  </div>

                  <div className="mt-3">
                    <p className="text-xs font-semibold text-neutral-900 mb-1">Inputs</p>
                    <InputsGrid inputs={(o.inputs ?? {}) as Record<string, unknown>} />
                  </div>

                  <p className="text-[11px] text-neutral-400 mt-3">Computed {formatDateTime(o.computed_at)}</p>
                </Card>
              ))}
            </div>
          </>
        )
      )}
    </div>
  );
}
