// Exercise UPDATE_EXISTING end to end against REAL production data.
//
// WHY THIS SCRIPT EXISTS
// ----------------------
// The UPDATE_EXISTING path was built, typechecked and deployed, and had never
// once run: production holds zero update proposals. "The code exists" is not
// the same as "the path works", and a report that counts the former as the
// latter is the failure this project keeps finding.
//
// It uses a REAL published article and REAL evidence URLs taken from the live
// corpus. It asserts the safety property that matters — the published article
// is byte-identical afterwards — and then removes the proposal it created.
//
// WHAT IT PROVES
//   1. A proposal can be created against a real published article.
//   2. The proposal carries what a reviewer needs: the article, the evidence,
//      the suggested changes, a reason, and a confidence.
//   3. THE ARTICLE IS NOT MODIFIED. Not its body, title, status or timestamps.
//   4. Re-running refreshes the same proposal instead of duplicating it.
//   5. Cleanup leaves the database as it was found.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-update-existing.ts

import { loadEnvLocal, createAdminClient } from "./_shared.ts";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const db = await createAdminClient();

  // ---- pick a real published article -------------------------------------
  const { data: pubRows, error: pubErr } = await db
    .from("content_items")
    .select("id, title, slug, status, body, published_at, updated_at")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1);
  if (pubErr) throw new Error(`published read failed: ${pubErr.message}`);
  const article = ((pubRows ?? []) as any[])[0];
  if (!article) throw new Error("no published article to exercise against");

  console.log(`\n  target article: ${article.title.slice(0, 62)}`);
  const before = JSON.stringify(article);

  // ---- real evidence, from sources already registered ---------------------
  const { data: srcRows } = await db
    .from("engine_sources").select("url").eq("is_active", true).limit(3);
  const evidence = ((srcRows ?? []) as { url: string }[]).map((s) => s.url);
  check("real evidence URLs available", evidence.length > 0, `${evidence.length} found`);

  const baseline = await countProposals(db);

  // ---- create the proposal ------------------------------------------------
  const { data: status, error: rpcErr } = await db.rpc("engine_upsert_update_proposal", {
    p_content_id: article.id,
    p_product_id: null,
    p_discovery_id: null,
    p_reason: "newer_evidence",
    p_summary:
      `VERIFICATION PROBE — safe to delete.\n\nNewer reporting exists on a development this page ` +
      `already covers. This proposal was created by scripts/verify-update-existing.ts to prove the ` +
      `path works, and does not describe a real editorial change.`,
    p_changes: [
      "Probe: a suggested addition would appear here.",
      "Probe: a suggested removal would appear here.",
    ],
    p_evidence: evidence,
    p_confidence: 0.6,
  });

  if (rpcErr) {
    check("proposal created", false, rpcErr.message);
  } else {
    check("proposal created", status === "created" || status === "refreshed", `RPC returned ${String(status)}`);
  }

  // ---- read it back the way a reviewer would ------------------------------
  const { data: proposals, error: readErr } = await db
    .from("engine_update_proposals")
    .select("id, content_id, reason, summary, proposed_changes, evidence_urls, confidence, state")
    .eq("content_id", article.id)
    .eq("state", "open");
  if (readErr) check("proposal readable", false, readErr.message);

  const mine = ((proposals ?? []) as any[]).find((p) => String(p.summary).includes("VERIFICATION PROBE"));
  check("proposal is readable and open", !!mine);
  if (mine) {
    check("it names the existing article", mine.content_id === article.id);
    check("it carries evidence", (mine.evidence_urls ?? []).length > 0, `${(mine.evidence_urls ?? []).length}`);
    check("it carries suggested changes", (mine.proposed_changes ?? []).length > 0);
    check("it carries a freshness reason", typeof mine.reason === "string" && mine.reason.length > 0, mine.reason);
    check("it carries a confidence", typeof mine.confidence === "number", String(mine.confidence));
  }

  // ---- THE SAFETY PROPERTY ------------------------------------------------
  const { data: afterRows, error: afterErr } = await db
    .from("content_items")
    .select("id, title, slug, status, body, published_at, updated_at")
    .eq("id", article.id)
    .limit(1);
  if (afterErr) check("article re-read", false, afterErr.message);
  const after = JSON.stringify(((afterRows ?? []) as any[])[0] ?? {});
  check("THE PUBLISHED ARTICLE IS UNCHANGED", after === before,
    after === before ? "" : "the article was modified — this must never happen");

  // ---- idempotency --------------------------------------------------------
  const { data: second } = await db.rpc("engine_upsert_update_proposal", {
    p_content_id: article.id, p_product_id: null, p_discovery_id: null,
    p_reason: "newer_evidence",
    p_summary: "VERIFICATION PROBE — safe to delete. Second call.",
    p_changes: ["Probe: refreshed."], p_evidence: evidence, p_confidence: 0.6,
  });
  const afterSecond = await countProposals(db);
  check("re-running refreshes rather than duplicating",
    afterSecond === baseline + 1, `${baseline} -> ${afterSecond} (RPC said ${String(second)})`);

  // ---- cleanup ------------------------------------------------------------
  if (mine) {
    const { error: delErr } = await db.from("engine_update_proposals").delete().eq("id", mine.id);
    check("probe removed", !delErr, delErr?.message);
  }
  const finalCount = await countProposals(db);
  check("database left as found", finalCount === baseline, `${baseline} -> ${finalCount}`);

  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

async function countProposals(db: Awaited<ReturnType<typeof createAdminClient>>): Promise<number> {
  const { count } = await db
    .from("engine_update_proposals")
    .select("*", { count: "exact", head: true });
  return count ?? 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
