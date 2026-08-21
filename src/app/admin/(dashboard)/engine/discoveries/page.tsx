import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader,
  Card,
  Badge,
  Field,
  Select,
  TextInput,
  EmptyState,
  QueryErrorBanner,
} from "@/components/admin/ui";
import { SubmitButton } from "@/components/admin/submit-button";
import { computeConfidence } from "@/lib/engine/confidence";
import type { ClaimStatus, DiscoveryType, EngineEvidence, PipelineState, TrustLevel } from "@/lib/engine/types";
import { setDiscoveryState } from "../actions";
import { ClaimStatusBadge, EngineTabs, StateBadge, TrustBadge, formatDateTime, humanise } from "../shared";

const STATE_FILTERS: (PipelineState | "")[] = [
  "",
  "discovered",
  "researched",
  "evidence_checked",
  "planned",
  "blocked",
  "rejected",
  "error",
];

const TYPE_FILTERS: (DiscoveryType | "")[] = [
  "",
  "product_launch",
  "product_update",
  "spec_change",
  "firmware_release",
  "technology_news",
  "recall_or_security",
  "new_topic",
];

// Triage states an admin can move a candidate into from here. "published" is
// deliberately absent — see the note on setDiscoveryState in actions.ts.
const TRIAGE_STATES: PipelineState[] = [
  "discovered",
  "researched",
  "evidence_checked",
  "planned",
  "blocked",
  "rejected",
];

export default async function EngineDiscoveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; type?: string }>;
}) {
  await requireAdmin();
  const { state, type } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("engine_discoveries")
    .select(
      "id, title, summary, discovery_type, category_slug, confidence, claim_status, state, state_reason, first_seen_at, last_seen_at, sighting_count"
    )
    .order("last_seen_at", { ascending: false })
    .limit(100);

  const validState = STATE_FILTERS.find((f) => f !== "" && f === state);
  if (validState) query = query.eq("state", validState);
  const validType = TYPE_FILTERS.find((f) => f !== "" && f === type);
  if (validType) query = query.eq("discovery_type", validType);

  const { data: discoveries, error } = await query;

  const ids = (discoveries ?? []).map((d) => d.id);
  const { data: evidence, error: evidenceError } =
    ids.length > 0
      ? await supabase
          .from("engine_discovery_evidence")
          .select("id, discovery_id, url, publisher, excerpt, claim_status, trust_level, originates_from_url, retrieved_at")
          .in("discovery_id", ids)
      : { data: [] as EngineEvidence[], error: null };

  const evidenceByDiscovery = new Map<string, EngineEvidence[]>();
  for (const e of (evidence ?? []) as EngineEvidence[]) {
    const list = evidenceByDiscovery.get(e.discovery_id) ?? [];
    list.push(e);
    evidenceByDiscovery.set(e.discovery_id, list);
  }

  const filterHref = (nextState: string, nextType: string) => {
    const params = new URLSearchParams();
    if (nextState) params.set("state", nextState);
    if (nextType) params.set("type", nextType);
    const qs = params.toString();
    return `/admin/engine/discoveries${qs ? `?${qs}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="Discoveries"
        description="Candidate records created by scheduled discovery. Candidates only — nothing here is content, and nothing here is published."
      />
      <EngineTabs current="/admin/engine/discoveries" />

      <div className="flex flex-col gap-2 mb-4">
        <div className="flex flex-wrap gap-2">
          {STATE_FILTERS.map((f) => (
            <a
              key={f || "all"}
              href={filterHref(f, type ?? "")}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                (state ?? "") === f ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {f ? humanise(f) : "All states"}
            </a>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {TYPE_FILTERS.map((f) => (
            <a
              key={f || "all"}
              href={filterHref(state ?? "", f)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                (type ?? "") === f ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {f ? humanise(f) : "All types"}
            </a>
          ))}
        </div>
      </div>

      {error && <QueryErrorBanner message={`Failed to load discoveries: ${error.message}`} />}
      {evidenceError && <QueryErrorBanner message={`Failed to load evidence: ${evidenceError.message}`} />}

      {!error && (discoveries ?? []).length === 0 ? (
        <EmptyState
          title="No discoveries"
          description="Scheduled discovery creates candidate records here once sources are registered and the engine is enabled."
        />
      ) : (
        !error && (
          <div className="flex flex-col gap-3">
            {(discoveries ?? []).map((d) => {
              const rows = evidenceByDiscovery.get(d.id) ?? [];
              // Recomputed from live evidence rather than trusting the stored
              // number — so the page shows what the evidence currently
              // supports, and any drift from the stored value is visible.
              const confidence = computeConfidence(
                rows.map((r) => ({
                  claim_status: r.claim_status,
                  trust_level: r.trust_level,
                  originates_from_url: r.originates_from_url,
                }))
              );
              const drifted = Math.abs(confidence.confidence - Number(d.confidence)) > 0.001;

              return (
                <Card key={d.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-900">{d.title}</p>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {humanise(d.discovery_type)}
                        {d.category_slug ? ` · ${d.category_slug}` : ""} · seen {d.sighting_count}×
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ClaimStatusBadge status={d.claim_status as ClaimStatus} />
                      <StateBadge state={d.state} />
                      <Badge tone="neutral">confidence {Number(d.confidence).toFixed(2)}</Badge>
                    </div>
                  </div>

                  {d.summary && <p className="text-sm text-neutral-700 mt-2">{d.summary}</p>}
                  {d.state_reason && <p className="text-xs text-neutral-500 mt-1">State reason: {d.state_reason}</p>}

                  <p className="text-xs text-neutral-400 mt-2">
                    First seen {formatDateTime(d.first_seen_at)} · last seen {formatDateTime(d.last_seen_at)}
                  </p>

                  <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3">
                    <p className="text-xs font-semibold text-neutral-900">
                      Why this confidence: {confidence.confidence.toFixed(2)}
                      {drifted && (
                        <span className="ml-2 font-normal text-amber-700">
                          (stored value is {Number(d.confidence).toFixed(2)} — recompute pending)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-neutral-700 mt-1">{confidence.explanation}</p>
                  </div>

                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-neutral-700">
                      Evidence ({rows.length})
                    </summary>
                    {rows.length === 0 ? (
                      <p className="text-xs text-neutral-500 mt-2">No evidence rows recorded for this candidate.</p>
                    ) : (
                      <ul className="flex flex-col gap-2 mt-2">
                        {rows.map((r) => (
                          <li
                            key={r.id}
                            className={`rounded border p-2 ${
                              r.originates_from_url ? "border-amber-200 bg-amber-50" : "border-neutral-200 bg-white"
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <ClaimStatusBadge status={r.claim_status as ClaimStatus} />
                              <TrustBadge level={r.trust_level as TrustLevel} />
                              {r.publisher && <span className="text-xs text-neutral-600">{r.publisher}</span>}
                            </div>
                            <p className="text-xs text-neutral-500 break-all mt-1">{r.url}</p>
                            {r.excerpt && <p className="text-xs text-neutral-700 mt-1">{r.excerpt}</p>}
                            {r.originates_from_url && (
                              <p className="text-xs text-amber-800 mt-1 break-all">
                                Repeats a claim originating at {r.originates_from_url} — excluded from corroboration so
                                circular reporting cannot inflate confidence.
                              </p>
                            )}
                            <p className="text-[11px] text-neutral-400 mt-1">
                              Retrieved {formatDateTime(r.retrieved_at)}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>

                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-neutral-700">Triage</summary>
                    <form action={setDiscoveryState} className="flex flex-col gap-3 mt-3 max-w-md">
                      <input type="hidden" name="id" value={d.id} />
                      <Field label="State" htmlFor={`state-${d.id}`}>
                        <Select id={`state-${d.id}`} name="state" defaultValue={d.state}>
                          {TRIAGE_STATES.map((s) => (
                            <option key={s} value={s}>
                              {humanise(s)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Reason" htmlFor={`reason-${d.id}`} hint="Why this candidate moved state.">
                        <TextInput id={`reason-${d.id}`} name="state_reason" defaultValue={d.state_reason ?? ""} />
                      </Field>
                      <div>
                        <SubmitButton pendingLabel="Saving...">Update state</SubmitButton>
                      </div>
                    </form>
                  </details>
                </Card>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
