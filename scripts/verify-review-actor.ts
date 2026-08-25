// Verify the human approval gate in PRODUCTION, semantically.
//
// "Success. No rows returned." means the SQL parsed and ran. It says nothing
// about whether the constraint actually refuses what it exists to refuse. This
// asserts the behaviour instead:
//
//   1. reviewed_by exists and is writable.
//   2. approved WITHOUT reviewed_by is IMPOSSIBLE — the whole point.
//   3. approved WITH reviewed_by is accepted.
//   4. pending may have reviewed_by NULL, so existing rows stay valid.
//   5. rejected may have reviewed_by NULL, likewise.
//   6. reviewed_by must reference a real auth.users row (FK enforced).
//   7. Every pre-existing brief still satisfies the constraint.
//
// Every row it creates is removed. It asserts the count is unchanged at the
// end rather than trusting its own cleanup.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-review-actor.ts

import { loadEnvLocal, createAdminClient } from "./_shared.ts";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}

/** The CHECK constraint rejecting an approval with no actor. */
const CONSTRAINT = "engine_briefs_approved_needs_reviewer";

async function main(): Promise<void> {
  loadEnvLocal();
  const db = await createAdminClient();

  const { data: userData } = await db.auth.getUser();
  const adminId = userData.user?.id;
  if (!adminId) throw new Error("no signed-in user; cannot exercise reviewed_by");
  console.log(`\n  signed-in admin: ${userData.user?.email}\n`);

  const before = await countBriefs(db);
  const created: string[] = [];

  async function seed(fields: Record<string, unknown>) {
    const { data, error } = await db
      .from("engine_briefs")
      .insert({
        proposed_title: `VERIFY-ACTOR probe ${crypto.randomUUID().slice(0, 8)}`,
        rationale: "Probe row created by scripts/verify-review-actor.ts. Safe to delete.",
        state: "planned",
        ...fields,
      })
      .select("id")
      .single();
    if (data) created.push((data as { id: string }).id);
    return { data, error };
  }

  // 1. The column exists and is writable.
  const pendingWithActor = await seed({ review_state: "pending", reviewed_by: adminId });
  check("reviewed_by exists and accepts a real user id", !pendingWithActor.error,
    pendingWithActor.error?.message);

  // 2. THE POINT OF THE MIGRATION: approved with no actor must be refused.
  const orphanApproval = await seed({ review_state: "approved" });
  const refused = !!orphanApproval.error;
  check("approved WITHOUT reviewed_by is refused", refused, orphanApproval.error ? "" : "IT WAS ACCEPTED");
  if (refused) {
    check("...and refused by the named CHECK constraint",
      String(orphanApproval.error?.message).includes(CONSTRAINT),
      orphanApproval.error?.message);
  }

  // 3. Approved WITH an actor is accepted — the gate must not block real work.
  const realApproval = await seed({ review_state: "approved", reviewed_by: adminId });
  check("approved WITH reviewed_by is accepted", !realApproval.error, realApproval.error?.message);

  // 4/5. Existing rows stay valid: pending and rejected may have no actor.
  const pendingNull = await seed({ review_state: "pending" });
  check("pending may have reviewed_by NULL", !pendingNull.error, pendingNull.error?.message);
  const rejectedNull = await seed({ review_state: "rejected" });
  check("rejected may have reviewed_by NULL", !rejectedNull.error, rejectedNull.error?.message);

  // 6. FK is real: a made-up actor must not be storable.
  const fakeActor = await seed({
    review_state: "approved",
    reviewed_by: "00000000-0000-0000-0000-000000000000",
  });
  check("reviewed_by must reference a real user (FK enforced)", !!fakeActor.error,
    fakeActor.error ? "" : "a non-existent user id was accepted");

  // 7. UPDATE path too: promoting a pending row to approved without an actor.
  if (pendingNull.data) {
    const id = (pendingNull.data as { id: string }).id;
    const { error: upErr } = await db
      .from("engine_briefs").update({ review_state: "approved" }).eq("id", id);
    check("promoting pending -> approved without an actor is refused", !!upErr,
      upErr ? "" : "the update was accepted");

    const { error: okErr } = await db
      .from("engine_briefs").update({ review_state: "approved", reviewed_by: adminId }).eq("id", id);
    check("promoting pending -> approved WITH an actor is accepted", !okErr, okErr?.message);
  }

  // 8. Every pre-existing brief still satisfies the constraint.
  const { data: violators, error: vErr } = await db
    .from("engine_briefs")
    .select("id")
    .eq("review_state", "approved")
    .is("reviewed_by", null);
  if (vErr) check("existing rows survey", false, vErr.message);
  else check("no existing approved brief lacks an actor", (violators ?? []).length === 0,
    `${(violators ?? []).length} violating rows`);

  // ---- cleanup ------------------------------------------------------------
  for (const id of created) {
    const { error } = await db.from("engine_briefs").delete().eq("id", id);
    if (error) console.error(`    cleanup failed for ${id}: ${error.message}`);
  }
  const after = await countBriefs(db);
  check("database left as found", after === before, `${before} -> ${after}`);

  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

async function countBriefs(db: Awaited<ReturnType<typeof createAdminClient>>): Promise<number> {
  const { count } = await db.from("engine_briefs").select("*", { count: "exact", head: true });
  return count ?? 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
