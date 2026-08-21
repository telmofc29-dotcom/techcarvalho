import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader,
  Card,
  Checkbox,
  Field,
  Textarea,
  EmptyState,
  QueryErrorBanner,
  Table,
  Th,
  Td,
} from "@/components/admin/ui";
import { SubmitButton } from "@/components/admin/submit-button";
import { Badge } from "@/components/shared/ui";
import type { EngineSettings, JobStatus } from "@/lib/engine/types";
import { updateEngineSettings } from "./actions";
import { EngineTabs, JobStatusBadge, formatDateTime, formatDuration, humanise } from "./shared";

type JobRun = {
  id: string;
  job_name: string;
  status: JobStatus;
  started_at: string;
  finished_at: string | null;
  items_examined: number;
  items_created: number;
  items_deduped: number;
  items_failed: number;
  detail: Record<string, unknown> | null;
  error: string | null;
};

/** The tick records its wall-clock time in detail.durationMs. */
function durationOf(run: JobRun): number | null {
  const d = run.detail?.durationMs;
  if (typeof d === "number") return d;
  if (run.finished_at) {
    const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
  }
  return null;
}

// Engine health + control surface. This is the page an admin opens to answer
// "is the engine on, what has it been doing, and did anything break" — so the
// kill switch and the audit log deliberately live together rather than in
// separate places.
export default async function EngineHealthPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [
    { data: settings, error: settingsError },
    { data: runs, error: runsError },
    { data: discoveryRows, error: discoveryCountError },
    { data: briefRows, error: briefCountError },
    { count: freshnessOpen, error: freshnessCountError },
  ] = await Promise.all([
    supabase
      .from("engine_settings")
      .select(
        "master_enabled, discovery_enabled, research_enabled, freshness_enabled, opportunity_scoring_enabled, autonomous_publishing_enabled, notes, updated_at"
      )
      .eq("id", true)
      .maybeSingle(),
    supabase
      .from("engine_job_runs")
      .select(
        "id, job_name, status, started_at, finished_at, items_examined, items_created, items_deduped, items_failed, detail, error"
      )
      .order("started_at", { ascending: false })
      .limit(200),
    supabase.from("engine_discoveries").select("relevance_verdict"),
    supabase.from("engine_briefs").select("review_state"),
    supabase
      .from("engine_freshness_reviews")
      .select("*", { count: "exact", head: true })
      .eq("state", "open"),
  ]);

  const s = (settings ?? null) as EngineSettings | null;
  const allRuns = (runs ?? []) as unknown as JobRun[];

  // Per-job rollup. "Last successful" is tracked separately from "last run" on
  // purpose: a job failing every night still has a recent run, and only the
  // gap between those two reveals it.
  const jobNames = [...new Set(allRuns.map((r) => r.job_name))].sort();
  const jobSummaries = jobNames.map((name) => {
    const history = allRuns.filter((r) => r.job_name === name);
    const last = history[0];
    const lastSuccess = history.find((r) => r.status === "success");
    return { name, last, lastSuccess, history: history.slice(0, 10) };
  });

  const failingJobs = jobSummaries.filter(
    (j) => j.last && (j.last.status === "failed" || j.last.status === "partial")
  );

  const relevanceCounts = new Map<string, number>();
  for (const d of (discoveryRows ?? []) as { relevance_verdict: string | null }[]) {
    const key = d.relevance_verdict ?? "unclassified";
    relevanceCounts.set(key, (relevanceCounts.get(key) ?? 0) + 1);
  }

  const reviewCounts = new Map<string, number>();
  for (const b of (briefRows ?? []) as { review_state: string }[]) {
    reviewCounts.set(b.review_state, (reviewCounts.get(b.review_state) ?? 0) + 1);
  }

  return (
    <div>
      <PageHeader
        title="Growth engine"
        description="Scheduled discovery, scoring and freshness monitoring. Everything here proposes work; nothing here publishes it."
      />
      <EngineTabs current="/admin/engine" />

      {settingsError && <QueryErrorBanner message={`Failed to load engine settings: ${settingsError.message}`} />}

      {!settingsError && !s && (
        <QueryErrorBanner message="No engine_settings row found. The migration inserts exactly one row — this suggests it has not been applied." />
      )}

      {s && (
        <>
          {/* Master state is stated in words, not just implied by a checkbox
              position — an admin glancing at this page must not have to infer
              whether the engine is live. */}
          <Card className={`p-5 mb-4 ${s.master_enabled ? "border-green-300 bg-green-50" : "border-neutral-300 bg-neutral-50"}`}>
            <p className="text-sm font-semibold text-neutral-900">
              {s.master_enabled ? "Engine is ON" : "Engine is OFF (master kill switch engaged)"}
            </p>
            <p className="text-xs text-neutral-600 mt-1">
              {s.master_enabled
                ? "Scheduled jobs will run according to the granular switches below."
                : "No scheduled engine job will do any work while this is off, regardless of the granular switches below."}
            </p>
          </Card>

          <Card
            className={`p-5 mb-6 ${
              s.autonomous_publishing_enabled ? "border-red-300 bg-red-50" : "border-blue-200 bg-blue-50"
            }`}
          >
            <p className="text-sm font-semibold text-neutral-900">
              {s.autonomous_publishing_enabled
                ? "Autonomous publishing is ENABLED"
                : "Autonomous publishing is off — this is the intended state"}
            </p>
            <p className="text-xs text-neutral-700 mt-1">
              {s.autonomous_publishing_enabled
                ? "The engine is permitted to publish without human review. This is a deliberate, high-consequence setting."
                : "Candidates and briefs still require a human to create and publish the resulting content through the normal editorial workflow. The media-first rule and publication gate remain in force either way."}
            </p>
          </Card>

          <Card className="p-5 mb-6">
            <h2 className="text-sm font-semibold text-neutral-900 mb-1">Controls</h2>
            <p className="text-xs text-neutral-500 mb-4">
              The master switch gates everything. A granular switch does nothing on its own while the master switch
              is off.
            </p>
            <form action={updateEngineSettings} className="flex flex-col gap-4 max-w-xl">
              <Checkbox
                name="master_enabled"
                label="Master enabled (kill switch)"
                defaultChecked={s.master_enabled}
              />
              <div className="flex flex-col gap-3 border-l-2 border-neutral-200 pl-4">
                <Checkbox name="discovery_enabled" label="Discovery" defaultChecked={s.discovery_enabled} />
                <Checkbox name="research_enabled" label="Research" defaultChecked={s.research_enabled} />
                <Checkbox name="freshness_enabled" label="Freshness checks" defaultChecked={s.freshness_enabled} />
                <Checkbox
                  name="opportunity_scoring_enabled"
                  label="Opportunity scoring"
                  defaultChecked={s.opportunity_scoring_enabled}
                />
              </div>
              <div className="rounded border border-red-200 bg-red-50 p-3">
                <Checkbox
                  name="autonomous_publishing_enabled"
                  label="Autonomous publishing (leave off)"
                  defaultChecked={s.autonomous_publishing_enabled}
                />
                <p className="text-xs text-red-700 mt-1">
                  Enabling this lets the engine publish without a human in the loop. It is separate from every other
                  switch precisely so it can never be turned on by accident.
                </p>
              </div>
              <Field label="Notes" htmlFor="notes" hint="Why the engine is in its current state, for whoever looks next.">
                <Textarea id="notes" name="notes" rows={2} defaultValue={s.notes ?? ""} />
              </Field>
              <div>
                <SubmitButton pendingLabel="Saving...">Save controls</SubmitButton>
              </div>
              <p className="text-xs text-neutral-400">Last updated {formatDateTime(s.updated_at)}</p>
            </form>
          </Card>
        </>
      )}

      {/* Pipeline volumes: what is sitting in each stage right now. */}
      <h2 className="text-sm font-semibold text-neutral-900 mb-1">Pipeline</h2>
      <p className="text-xs text-neutral-500 mb-3">
        What the engine currently holds at each stage. Rejected discoveries are parked, never deleted.
      </p>

      {discoveryCountError && (
        <QueryErrorBanner message={`Failed to count discoveries: ${discoveryCountError.message}`} />
      )}
      {briefCountError && <QueryErrorBanner message={`Failed to count briefs: ${briefCountError.message}`} />}
      {freshnessCountError && (
        <QueryErrorBanner message={`Failed to count freshness alerts: ${freshnessCountError.message}`} />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-2">Discoveries by relevance</p>
          {relevanceCounts.size === 0 ? (
            <p className="text-sm text-neutral-500">None yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {["relevant", "uncertain", "rejected", "unclassified"]
                .filter((k) => relevanceCounts.has(k))
                .map((k) => (
                  <li key={k} className="flex items-center justify-between text-sm">
                    <span className="text-neutral-700">{humanise(k)}</span>
                    <span className="font-semibold text-neutral-900 tabular-nums">{relevanceCounts.get(k)}</span>
                  </li>
                ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-2">Briefs by review state</p>
          {reviewCounts.size === 0 ? (
            <p className="text-sm text-neutral-500">None yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {["pending", "approved", "research_requested", "snoozed", "rejected"]
                .filter((k) => reviewCounts.has(k))
                .map((k) => (
                  <li key={k} className="flex items-center justify-between text-sm">
                    <span className="text-neutral-700">{humanise(k)}</span>
                    <span className="font-semibold text-neutral-900 tabular-nums">{reviewCounts.get(k)}</span>
                  </li>
                ))}
            </ul>
          )}
        </Card>

        <Card className={`p-4 ${(freshnessOpen ?? 0) > 0 ? "border-amber-300 bg-amber-50" : ""}`}>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-2">Open freshness alerts</p>
          <p className="text-lg font-semibold text-neutral-900 tabular-nums">{freshnessOpen ?? 0}</p>
          <p className="text-xs text-neutral-500 mt-1">Recommendations awaiting a human; nothing is auto-rewritten.</p>
        </Card>
      </div>

      {/* Failures first and loud — a broken job must not be something you have
          to scroll a table to notice. */}
      {failingJobs.length > 0 && (
        <Card className="p-4 mb-6 border-red-300 bg-red-50">
          <p className="text-sm font-semibold text-neutral-900">
            {failingJobs.length} job{failingJobs.length === 1 ? "" : "s"} last ran with problems
          </p>
          <ul className="flex flex-col gap-2 mt-2">
            {failingJobs.map((j) => (
              <li key={j.name} className="text-xs">
                <span className="font-medium text-neutral-900">{j.name}</span>{" "}
                <JobStatusBadge status={j.last!.status} /> — last ran {formatDateTime(j.last!.started_at)}
                {j.lastSuccess ? (
                  <>, last succeeded {formatDateTime(j.lastSuccess.started_at)}</>
                ) : (
                  <span className="text-red-800 font-medium"> — has never succeeded</span>
                )}
                {j.last!.error && <p className="text-red-800 mt-0.5 break-words">{j.last!.error}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <h2 className="text-sm font-semibold text-neutral-900 mb-1">Jobs</h2>
      <p className="text-xs text-neutral-500 mb-3">
        One row per job: when it last ran, when it last actually succeeded, and how the last ten runs went.
      </p>

      {runsError && <QueryErrorBanner message={`Failed to load job runs: ${runsError.message}`} />}

      {!runsError && jobSummaries.length > 0 && (
        <div className="flex flex-col gap-2 mb-6">
          {jobSummaries.map((j) => {
            const staleSuccess =
              j.lastSuccess && j.last && j.lastSuccess.id !== j.last.id ? true : !j.lastSuccess;
            return (
              <Card key={j.name} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-neutral-900">{j.name}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Last run {formatDateTime(j.last?.started_at ?? null)}
                      {j.last ? ` · ${formatDuration(durationOf(j.last))}` : ""}
                    </p>
                    <p className={`text-xs mt-0.5 ${staleSuccess ? "text-amber-800" : "text-neutral-500"}`}>
                      {j.lastSuccess
                        ? `Last success ${formatDateTime(j.lastSuccess.started_at)}`
                        : "Never completed successfully"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {j.last && <JobStatusBadge status={j.last.status} />}
                    {j.last && (
                      <Badge tone="neutral">
                        {j.last.items_examined} examined · {j.last.items_created} created ·{" "}
                        {j.last.items_deduped} deduped · {j.last.items_failed} failed
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Compact run history — the shape of recent runs at a glance. */}
                <div className="flex flex-wrap items-center gap-1 mt-3">
                  <span className="text-[11px] text-neutral-400 mr-1">Last {j.history.length}:</span>
                  {j.history
                    .slice()
                    .reverse()
                    .map((r) => (
                      <span
                        key={r.id}
                        title={`${r.status} — ${formatDateTime(r.started_at)}`}
                        className={`inline-block h-3 w-3 rounded-sm ${
                          r.status === "success"
                            ? "bg-green-500"
                            : r.status === "partial"
                              ? "bg-amber-500"
                              : r.status === "failed"
                                ? "bg-red-500"
                                : r.status === "running"
                                  ? "bg-blue-400"
                                  : "bg-neutral-300"
                        }`}
                      />
                    ))}
                </div>

                {j.last?.error && (
                  <p className="text-xs text-red-800 mt-2 break-words">Last error: {j.last.error}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <h2 className="text-sm font-semibold text-neutral-900 mb-1">Recent job runs</h2>
      <p className="text-xs text-neutral-500 mb-3">
        Audit log of every scheduled run — what ran, what it did, and what failed.
      </p>

      {!runsError && allRuns.length === 0 ? (
        <EmptyState
          title="No job runs recorded yet"
          description="Scheduled engine jobs append a row here each time they run."
        />
      ) : (
        !runsError && (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Job</Th>
                  <Th>Status</Th>
                  <Th>Started</Th>
                  <Th>Duration</Th>
                  <Th>Examined</Th>
                  <Th>Created</Th>
                  <Th>Deduped</Th>
                  <Th>Failed</Th>
                  <Th>Error</Th>
                </tr>
              </thead>
              <tbody>
                {allRuns.slice(0, 40).map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium text-neutral-900 whitespace-nowrap">{r.job_name}</Td>
                    <Td>
                      <JobStatusBadge status={r.status} />
                    </Td>
                    <Td className="whitespace-nowrap text-neutral-600">{formatDateTime(r.started_at)}</Td>
                    <Td className="whitespace-nowrap text-neutral-600">{formatDuration(durationOf(r))}</Td>
                    <Td className="tabular-nums">{r.items_examined}</Td>
                    <Td className="tabular-nums">{r.items_created}</Td>
                    <Td className="tabular-nums">{r.items_deduped}</Td>
                    <Td className="tabular-nums">{r.items_failed}</Td>
                    <Td className="text-red-700 max-w-xs">{r.error ?? ""}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )
      )}
    </div>
  );
}
