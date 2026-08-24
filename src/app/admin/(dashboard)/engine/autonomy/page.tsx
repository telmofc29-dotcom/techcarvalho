import { requireAdmin } from "@/lib/dal";
import { PageHeader, Card, Badge, EmptyState } from "@/components/admin/ui";
import { EngineTabs } from "../shared";
import { loadProofRecords } from "@/lib/engine/proof-store";
import { evaluateAllProofs, REQUIRED_LEVEL, PROOF_TTL_DAYS, type ProofStatus } from "@/lib/engine/proofs";
import { resolveEffectiveMode, READINESS, modeMayPublish } from "@/lib/engine/modes";
import { assessShadowReadiness } from "@/lib/engine/shadow-readiness";
import { createClient } from "@/lib/supabase/server";
import { StageModesPanel } from "./stage-modes-panel";

/** Row shapes returned by the shadow RPCs. Declared here so the page does not
 *  silently accept a differently-shaped answer. */
type LedgerRowShape = {
  candidate_identity: string;
  title: string;
  publisher: string | null;
  decided_on: string;
  record_kind: string;
  outcome: string | null;
  terminal_stage: string;
  reached_gate: boolean;
  dimensions: string[] | null;
};
type EscapeRowShape = {
  would_publish: number;
  fabricated_claim_escapes: number;
  unlicensed_media_escapes: number;
  bypassed_hard_blockers: number;
  duplicate_leakage: number;
  human_reviewed: number;
  human_disagreed: number;
};

// Autonomy readiness.
//
// The one thing this page exists to make unmistakable: IMPLEMENTED is not
// PROVEN. Every capability in this engine has a module and a passing unit
// test. None of that is evidence about what happens when the thing actually
// breaks, and a dashboard that showed green for "the code exists" would be
// worse than no dashboard — it would manufacture confidence.
//
// So every row here reads PROVEN or NOT PROVEN, and NOT PROVEN states WHY in
// the same breath. There is no aggregate percentage anywhere on the page,
// deliberately: "97% ready" is a number with nothing attached to it, and it is
// where uncertainty goes to hide.
//
// Nothing on this page can CHANGE anything. There is no form, no action, no
// button that flips a proof or unlocks a mode. Proof records live in
// data/engine/proof-records.ts — changing one takes a commit, not a click.

export const dynamic = "force-dynamic";

function ProofRow({ status }: { status: ProofStatus }) {
  // Three states, not two. NOT IMPLEMENTED is deliberately a separate word from
  // NOT PROVEN: the latter reads as "built, not yet broken on purpose", which
  // is a to-do. The former means there is nothing to exercise at all, and
  // showing them identically overstates how far along the engine is.
  const label =
    status.state === "PROVEN"
      ? "PROVEN"
      : status.state === "NOT_IMPLEMENTED"
        ? "NOT IMPLEMENTED"
        : "NOT PROVEN";
  return (
    <tr className="border-b border-border-subtle last:border-0">
      <td className="py-2.5 pr-4 align-top font-mono text-xs text-zinc-700">{status.kind}</td>
      <td className="py-2.5 pr-4 align-top whitespace-nowrap">
        <Badge tone={status.state === "PROVEN" ? "green" : "red"}>{label}</Badge>
      </td>
      <td className="py-2.5 pr-4 align-top whitespace-nowrap text-xs text-zinc-500">
        needs {REQUIRED_LEVEL[status.kind]}
      </td>
      <td className="py-2.5 align-top text-xs leading-relaxed text-zinc-600">{status.reason}</td>
    </tr>
  );
}

export default async function AutonomyReadinessPage() {
  await requireAdmin();

  const records = loadProofRecords();
  const { statuses, provenCount } = evaluateAllProofs(records);

  // Read the REAL shadow ledger.
  //
  // This block used to hardcode zeros, with a comment explaining that zero was
  // the truthful number because no shadow pass had run. That was true when it
  // was written and stopped being true the moment 118 decisions were recorded —
  // at which point the page was understating, and a comment asserting honesty
  // was doing the opposite. A hardcoded number cannot stay honest; only a read
  // can. Conservative means "does not overstate", not "always says zero".
  const supabase = await createClient();
  const [ledgerResult, escapesResult] = await Promise.all([
    supabase.rpc("engine_shadow_ledger", { p_limit: 20000 }),
    supabase.rpc("engine_shadow_escapes"),
  ]);

  // A failed read is NOT an empty ledger. If either query errors, the page says
  // so rather than rendering zeros that look like a measured result — the
  // project's empty-vs-failed rule, applied to the readiness dashboard itself.
  // Tracked SEPARATELY. Collapsing them into one flag would mean a failed
  // escapes read could be reported as a ledger problem, and vice versa — and
  // the escape counts are the zero-tolerance ones.
  const ledgerError = ledgerResult.error ?? null;
  const escapesError = escapesResult.error ?? null;
  const anyReadError = ledgerError ?? escapesError;
  const ledgerRows = (ledgerResult.data ?? []) as LedgerRowShape[];
  const escapeRow = ((escapesResult.data ?? []) as EscapeRowShape[])[0];

  const readiness = assessShadowReadiness({
    ledger: ledgerRows.map((r) => ({
      candidateIdentity: r.candidate_identity,
      title: r.title,
      publisher: r.publisher,
      decidedOn: r.decided_on,
      recordKind: r.record_kind === "decision" ? "decision" : "failure",
      outcome: r.outcome as "WOULD_PUBLISH" | "WOULD_REJECT" | "HUMAN_REVIEW_REQUIRED" | null,
      terminalStage: r.terminal_stage,
      reachedGate: r.reached_gate,
      dimensions: r.dimensions ?? [],
    })),
    escapes: {
      wouldPublish: escapeRow?.would_publish ?? 0,
      fabricatedClaimEscapes: escapeRow?.fabricated_claim_escapes ?? 0,
      unlicensedMediaEscapes: escapeRow?.unlicensed_media_escapes ?? 0,
      bypassedHardBlockers: escapeRow?.bypassed_hard_blockers ?? 0,
      duplicateLeakage: escapeRow?.duplicate_leakage ?? 0,
      humanReviewed: escapeRow?.human_reviewed ?? 0,
      humanDisagreed: escapeRow?.human_disagreed ?? 0,
    },
    proofRecords: records,
    ledgerAvailable: ledgerError === null,
    ledgerUnavailableReason: ledgerError?.message,
    escapesAvailable: escapesError === null,
    escapesUnavailableReason: escapesError?.message,
  });
  // The mode an operator might REQUEST, and what the gate actually permits.
  // The COMBINED verdict, not readiness.modes. modes.ts does not know about
  // the composition gate, so passing its raw report announced CANARY — a mode
  // that publishes — while 8 of 15 coverage dimensions were below their floor.
  const effective = resolveEffectiveMode("AUTONOMOUS", readiness);

  // `select("*")` rather than naming the column: stage_modes ships in
  // supabase/migrations_pending/20260824_stage_modes.sql and is not applied
  // yet, and naming an absent column errors the entire read. Presence of the
  // KEY is what tells us whether the column exists — which is also exactly what
  // decides whether the panel is editable or read-only.
  const supabaseSettings = await createClient();
  const { data: settingsRow } = await supabaseSettings
    .from("engine_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  const settingsObject = (settingsRow ?? null) as Record<string, unknown> | null;
  const stageModesColumnExists = settingsObject !== null && "stage_modes" in settingsObject;
  const storedStageModes = settingsObject?.stage_modes ?? null;

  return (
    <div>
      <EngineTabs current="/admin/engine/autonomy" />
      <PageHeader
        title="Autonomy readiness"
        description="What has been DEMONSTRATED, not what has been built. A passing unit test is not evidence about what happens when something breaks."
      />

      <StageModesPanel storedModes={storedStageModes} columnExists={stageModesColumnExists} />

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm font-semibold tracking-wide">AUTONOMOUS MODE:</span>
          <Badge tone={readiness.autonomousUnlocked ? "green" : "red"}>
            {readiness.autonomousUnlocked ? "UNLOCKED" : "LOCKED"}
          </Badge>
          <span className="text-sm text-zinc-600">
            Highest justified mode: <strong>{readiness.highestJustifiedMode}</strong>
            {modeMayPublish(readiness.highestJustifiedMode) ? "" : " — publishes nothing"}
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600">
          Requesting AUTONOMOUS right now resolves to <strong>{effective.mode}</strong>.{" "}
          {effective.reason}
        </p>
        <p className="mt-3 rounded-md bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-600">
          The publication boundary is structural, not a setting on this page. Engine jobs run as{" "}
          <code>anon</code>, direct publishing writes are refused by the database with{" "}
          <code>42501</code>, and no RPC the engine can call sets{" "}
          <code>status=&apos;published&apos;</code> or <code>is_published=true</code>. Enabling
          autonomy would require adding a publishing RPC that does not exist.
        </p>
      </Card>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Failure proofs — {provenCount} of {statuses.length} proven
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">
          A proof is a record of an execution: what was run, what was observed, at which commit.
          Records live in <code>data/engine/proof-records.ts</code> and expire after{" "}
          {PROOF_TTL_DAYS} days, because a proof about code from 200 commits ago is not a proof
          about this code. Nothing on this page can change one.
        </p>
        {statuses.some((s) => s.state === "NOT_IMPLEMENTED") && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-900">
            {statuses.filter((s) => s.state === "NOT_IMPLEMENTED").map((s) => s.kind).join(", ")} —{" "}
            <strong>NOT IMPLEMENTED</strong>, which is a stronger statement than not proven. There is
            no code to exercise, so this proof is unobtainable until the capability is built. Both
            CANARY and AUTONOMOUS require it, so neither can be justified today no matter how much
            shadow evidence accumulates. Closing it takes a deliberate decision: build the mechanism,
            or establish that this engine genuinely does not need it and remove the requirement.
          </p>
        )}
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          <strong>PROVEN is not the same as OPERABLE.</strong> A proof records that a mechanism
          behaved correctly when it was exercised. It does not say the mechanism is wired into the
          running engine. <code>rollback_test</code> is the current example: the reversal logic and
          every refusal rule are proven against production, but the engine does not yet RECORD what
          it writes, so a real past run cannot be reversed — there is nothing durable saying what it
          did. The missing half is drafted at{" "}
          <code>supabase/migrations_pending/20260823_engine_change_log.sql</code> and is not applied.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-zinc-500">
                <th className="pb-2 pr-4 font-medium">Proof</th>
                <th className="pb-2 pr-4 font-medium">State</th>
                <th className="pb-2 pr-4 font-medium">Required level</th>
                <th className="pb-2 font-medium">Evidence / why not</th>
              </tr>
            </thead>
            <tbody>
              {statuses.map((s) => (
                <ProofRow key={s.kind} status={s} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Shadow evaluation
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">
          Shadow decisions: <strong>{readiness.modes.progress.shadowDecisions}</strong> of{" "}
          {readiness.modes.progress.required}, across {readiness.modes.progress.distinctDays} of{" "}
          {readiness.modes.progress.requiredDays} required distinct days.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">{readiness.composition.summary}</p>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          Recorded but refused credit — duplicates: {readiness.refusedCredit.duplicates}, incomplete:{" "}
          {readiness.refusedCredit.incomplete}, over the family cap: {readiness.refusedCredit.familyCap}.
          Re-running the evaluation banks no additional credit: the recording RPC dedupes on the
          candidate, server-side, so the 500 cannot be reached by repetition.
        </p>
        {anyReadError !== null && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-900">
            A READINESS SOURCE COULD NOT BE READ: {anyReadError.message}. The numbers above are not a
            measurement of zero — they are the absence of one, and readiness is held at its most
            pessimistic value until the read succeeds.
          </p>
        )}
        {anyReadError === null && readiness.modes.progress.shadowDecisions === 0 && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            No shadow decisions have been recorded. The ledger WAS read successfully, so this is a
            measured zero rather than a failed query. A decision counts only when it reaches a
            meaningful final gate or a legitimate fail-closed state; a candidate that died because a
            stage crashed is a failure, not a decision.
          </p>
        )}
      </Card>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Remaining graduation blockers — {readiness.blockers.length}
        </h2>
        {readiness.blockers.length === 0 ? (
          <EmptyState title="No blockers" description="Every graduation criterion is satisfied." />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-zinc-500">
                  <th className="pb-2 pr-4 font-medium">Criterion</th>
                  <th className="pb-2 pr-4 font-medium">Required</th>
                  <th className="pb-2 font-medium">Actual</th>
                </tr>
              </thead>
              <tbody>
                {readiness.blockers.map((b) => (
                  <tr key={b.criterion} className="border-b border-border-subtle last:border-0">
                    <td className="py-2.5 pr-4 align-top text-zinc-700">{b.criterion}</td>
                    <td className="py-2.5 pr-4 align-top whitespace-nowrap font-mono text-xs text-zinc-500">
                      {b.required}
                    </td>
                    <td className="py-2.5 align-top text-xs leading-relaxed text-zinc-600">{b.actual}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs leading-relaxed text-zinc-500">
          Escapes are held at zero on purpose — fabricated claims, unlicensed media and bypassed
          hard blockers damage readers or expose the publication legally, and there is no
          acceptable rate for any of them. Duplicate leakage allows{" "}
          {READINESS.maxDuplicateLeakageRate * 100}% because an editor can merge two pages; they
          cannot un-publish a fabricated price.
        </p>
      </Card>
    </div>
  );
}
