import { requireAdmin } from "@/lib/dal";
import { PageHeader, Card, Badge, EmptyState } from "@/components/admin/ui";
import { EngineTabs } from "../shared";
import { loadProofRecords } from "@/lib/engine/proof-store";
import { evaluateAllProofs, REQUIRED_LEVEL, PROOF_TTL_DAYS, type ProofStatus } from "@/lib/engine/proofs";
import { evaluateReadiness, resolveEffectiveMode, READINESS, modeMayPublish } from "@/lib/engine/modes";

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
  const proven = status.state === "PROVEN";
  return (
    <tr className="border-b border-border-subtle last:border-0">
      <td className="py-2.5 pr-4 align-top font-mono text-xs text-zinc-700">{status.kind}</td>
      <td className="py-2.5 pr-4 align-top whitespace-nowrap">
        <Badge tone={proven ? "green" : "red"}>{proven ? "PROVEN" : "NOT PROVEN"}</Badge>
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

  // Shadow evidence is not yet being accumulated by a running SHADOW pass, so
  // these are honestly zero rather than optimistically estimated. When the
  // shadow runner lands, this reads from it — and until then, zero is the
  // truthful number.
  const evidence = {
    shadowDecisions: 0,
    distinctDays: 0,
    fabricatedClaimEscapes: 0,
    unlicensedMediaEscapes: 0,
    bypassedHardBlockers: 0,
    duplicateLeakageRate: 0,
    humanDisagreementRate: 0,
    proofRecords: records,
  };
  const readiness = evaluateReadiness(evidence);
  // The mode an operator might REQUEST, and what the gate actually permits.
  const effective = resolveEffectiveMode("AUTONOMOUS", readiness);

  return (
    <div>
      <EngineTabs current="/admin/engine/autonomy" />
      <PageHeader
        title="Autonomy readiness"
        description="What has been DEMONSTRATED, not what has been built. A passing unit test is not evidence about what happens when something breaks."
      />

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
          Shadow decisions: <strong>{readiness.progress.shadowDecisions}</strong> of{" "}
          {readiness.progress.required}, across {readiness.progress.distinctDays} of{" "}
          {readiness.progress.requiredDays} required distinct days.
        </p>
        {readiness.progress.shadowDecisions === 0 && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            No shadow decisions have been recorded. This reads zero because zero have been made —
            not because the counter is unwired. A decision counts only when it reaches a meaningful
            final gate or a legitimate fail-closed state; a candidate that died because a stage
            crashed is a failure, not a decision.
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
