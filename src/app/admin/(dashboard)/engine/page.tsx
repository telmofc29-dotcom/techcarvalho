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
import type { EngineSettings, JobStatus } from "@/lib/engine/types";
import { updateEngineSettings } from "./actions";
import { EngineTabs, JobStatusBadge, formatDateTime } from "./shared";

// Engine health + control surface. This is the page an admin opens to answer
// "is the engine on, what has it been doing, and did anything break" — so the
// kill switch and the audit log deliberately live together rather than in
// separate places.
export default async function EngineHealthPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: settings, error: settingsError }, { data: runs, error: runsError }] = await Promise.all([
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
        "id, job_name, status, started_at, finished_at, items_examined, items_created, items_deduped, items_failed, error"
      )
      .order("started_at", { ascending: false })
      .limit(30),
  ]);

  const s = (settings ?? null) as EngineSettings | null;

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

      <h2 className="text-sm font-semibold text-neutral-900 mb-1">Recent job runs</h2>
      <p className="text-xs text-neutral-500 mb-3">
        Audit log of every scheduled run — what ran, what it did, and what failed.
      </p>

      {runsError && <QueryErrorBanner message={`Failed to load job runs: ${runsError.message}`} />}

      {!runsError && (runs ?? []).length === 0 ? (
        <EmptyState
          title="No job runs recorded yet"
          description="Scheduled engine jobs append a row here each time they run."
        />
      ) : (
        !runsError && (
          <Table>
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Status</Th>
                <Th>Started</Th>
                <Th>Finished</Th>
                <Th>Examined</Th>
                <Th>Created</Th>
                <Th>Deduped</Th>
                <Th>Failed</Th>
                <Th>Error</Th>
              </tr>
            </thead>
            <tbody>
              {(runs ?? []).map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium text-neutral-900 whitespace-nowrap">{r.job_name}</Td>
                  <Td>
                    <JobStatusBadge status={r.status as JobStatus} />
                  </Td>
                  <Td className="whitespace-nowrap text-neutral-600">{formatDateTime(r.started_at)}</Td>
                  <Td className="whitespace-nowrap text-neutral-600">{formatDateTime(r.finished_at)}</Td>
                  <Td className="tabular-nums">{r.items_examined}</Td>
                  <Td className="tabular-nums">{r.items_created}</Td>
                  <Td className="tabular-nums">{r.items_deduped}</Td>
                  <Td className="tabular-nums">{r.items_failed}</Td>
                  <Td className="text-red-700 max-w-xs">{r.error ?? ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      )}
    </div>
  );
}
