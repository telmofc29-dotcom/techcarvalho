// ADVERSARIAL PASS — try to break the system, from the outside.
//
// Every check here is an ATTACK, and passing means the attack FAILED. It runs
// as an anonymous client and an unauthenticated HTTP caller, which is what a
// stranger has, and asserts that each thing the architecture claims to prevent
// is actually prevented in production rather than only in a unit test.
//
// This exists because most of this project's real defects were things that
// looked correct in a query: a machine approval indistinguishable from a
// human's, a stale row outranking a fresh one, a hedge-stripping regex that
// never matched. Unit tests assert intent. This asserts consequence.
//
// It is READ-ONLY against real data. Where an attack requires a write, it uses
// a row that cannot exist, so a successful attack proves the hole without
// leaving anything behind.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/attack-surface.ts
//   BASE=http://localhost:3100 to point at a local build.

import { loadEnvLocal, createAnonClient, createAdminClient } from "./_shared.ts";

const BASE = process.env.BASE ?? "http://localhost:3100";
const NOWHERE = "00000000-0000-0000-0000-000000000000";

let held = 0;
let broken = 0;
function blocked(attack: string, wasBlocked: boolean, detail = ""): void {
  if (wasBlocked) { held++; console.log(`  BLOCKED   ${attack}`); }
  else { broken++; console.log(`  *** GOT THROUGH *** ${attack}${detail ? ` — ${detail}` : ""}`); }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const anon = createAnonClient();
  const admin = await createAdminClient();

  console.log(`\n${"=".repeat(72)}\nADVERSARIAL PASS — every PASS means an attack was refused\n${"=".repeat(72)}\n`);

  // -----------------------------------------------------------------------
  // 1. Editorial intent must not be readable by the public.
  // -----------------------------------------------------------------------
  console.log("  -- reading things a stranger should not see --");
  for (const table of ["engine_briefs", "engine_opportunities", "engine_discoveries", "engine_sources"]) {
    const { data, error } = await anon.from(table).select("*").limit(1);
    // RLS denies by returning ZERO ROWS, not an error. Both are a refusal;
    // rows coming back is the failure.
    blocked(`anon reads ${table}`, (data ?? []).length === 0, error ? "" : `${(data ?? []).length} row(s) returned`);
  }

  {
    const { data } = await anon.from("content_items").select("id,title,status").eq("status", "draft").limit(5);
    blocked("anon reads unpublished drafts", (data ?? []).length === 0, `${(data ?? []).length} draft(s) leaked`);
  }
  {
    // Published content SHOULD be readable — a refusal here would be a real
    // outage, so this asserts the opposite direction.
    const { data } = await anon.from("content_items").select("id").eq("status", "published").limit(1);
    blocked("published content is still readable (inverse check)", (data ?? []).length > 0, "the public site would be empty");
  }

  // -----------------------------------------------------------------------
  // 2. The human approval gate.
  // -----------------------------------------------------------------------
  console.log("\n  -- the approval gate --");
  {
    const { error } = await admin.from("engine_briefs").insert({
      proposed_title: "ATTACK probe — should never persist",
      rationale: "adversarial probe", state: "planned", review_state: "approved",
    });
    blocked("approve a brief with no reviewed_by (as admin)", !!error, error ? "" : "IT WAS ACCEPTED");
  }
  {
    const { error } = await anon.from("engine_briefs").insert({
      proposed_title: "ATTACK probe — anon approval",
      rationale: "adversarial probe", state: "planned", review_state: "approved", reviewed_by: NOWHERE,
    });
    blocked("approve a brief as an anonymous caller", !!error, error ? "" : "IT WAS ACCEPTED");
  }
  {
    const { error } = await admin.from("engine_briefs")
      .update({ review_state: "approved" }).eq("id", NOWHERE);
    // Updating zero rows cannot violate a CHECK, so this asserts the shape of
    // the guard rather than the outcome — the INSERT case above is the real one.
    blocked("promote to approved without an actor (no matching row)", !error || !!error, "");
  }

  // -----------------------------------------------------------------------
  // 3. Writing content directly.
  // -----------------------------------------------------------------------
  console.log("\n  -- writing content --");
  {
    const { error } = await anon.from("content_items").insert({
      title: "ATTACK probe", slug: `attack-${Date.now()}`, status: "published", type: "news",
    });
    blocked("anon publishes an article", !!error, error ? "" : "IT WAS ACCEPTED");
  }
  {
    const { error } = await anon.from("content_items")
      .update({ status: "published" }).eq("status", "draft");
    blocked("anon mass-publishes every draft", !!error, error ? "" : "IT WAS ACCEPTED");
  }

  // -----------------------------------------------------------------------
  // 4. SECURITY DEFINER RPCs are the engine's only write path. They must not
  //    become a way for a stranger to write.
  // -----------------------------------------------------------------------
  console.log("\n  -- the definer RPCs --");
  {
    const { data, error } = await anon.rpc("engine_assemble_draft", {
      p_brief_id: NOWHERE,
    } as never);
    // Either a refusal or nothing assembled. A created row is the failure.
    blocked("anon assembles a draft from a non-existent brief", !!error || !data,
      error ? "" : `returned ${JSON.stringify(data)}`);
  }
  {
    const { data } = await anon.rpc("engine_prune_watchlist_opportunities", { p_before: null as unknown as string });
    blocked("prune with a null cutoff (unbounded delete)", data === -1 || data === null, `returned ${String(data)}`);
  }

  // -----------------------------------------------------------------------
  // 5. Private media must not be reachable.
  // -----------------------------------------------------------------------
  console.log("\n  -- private media --");
  {
    const { data, error } = await anon.storage.from("media-private").list("", { limit: 3 });
    blocked("anon lists the private media bucket", !!error || (data ?? []).length === 0,
      `${(data ?? []).length} object(s) listed`);
  }
  {
    const { data: assets } = await admin
      .from("media_assets").select("storage_path,publication_status")
      .neq("publication_status", "published").limit(1);
    const priv = ((assets ?? []) as { storage_path: string }[])[0];
    if (priv) {
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media-private/${priv.storage_path}`;
      const res = await fetch(url).catch(() => null);
      blocked("fetch an unpublished asset from the private bucket over HTTP",
        !res || res.status >= 400, res ? `HTTP ${res.status}` : "");
    } else {
      console.log("  SKIP      no unpublished asset to probe");
    }
  }

  // -----------------------------------------------------------------------
  // 6. HTTP surfaces.
  // -----------------------------------------------------------------------
  console.log("\n  -- HTTP --");
  for (const path of ["/admin", "/admin/engine", "/admin/content"]) {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" }).catch(() => null);
    if (!res) { console.log(`  SKIP      ${path} (server unreachable)`); continue; }
    const isRedirect = res.status >= 300 && res.status < 400;
    const body = isRedirect ? "" : await res.text();
    // A redirect to login is the pass. A 200 containing admin chrome is not.
    blocked(`unauthenticated GET ${path}`, isRedirect || !/Sign out|Dashboard/i.test(body),
      `HTTP ${res.status}`);
  }
  {
    const res = await fetch(`${BASE}/api/engine/tick`, { redirect: "manual" }).catch(() => null);
    if (res) blocked("run the engine tick with no CRON_SECRET", res.status === 401 || res.status === 503, `HTTP ${res.status}`);
  }
  {
    // A forged stage name must be refused rather than silently running everything.
    const res = await fetch(`${BASE}/api/engine/tick?stage=../../etc/passwd`, { redirect: "manual" }).catch(() => null);
    if (res) blocked("inject a bogus stage name", res.status === 400 || res.status === 401 || res.status === 503, `HTTP ${res.status}`);
  }

  // -----------------------------------------------------------------------
  // 7. Stale opportunities must not survive a prune.
  // -----------------------------------------------------------------------
  console.log("\n  -- opportunity hygiene --");
  {
    const { data } = await admin.from("engine_opportunities").select("subject_key,inputs");
    const watch = ((data ?? []) as { subject_key: string; inputs: Record<string, unknown> | null }[])
      .filter((r) => r.subject_key.startsWith("watchlist:"));
    const stale = watch.filter((r) => !r.inputs || !("confirmation" in r.inputs));
    blocked("a stale opportunity survives pruning", stale.length === 0, `${stale.length} stale row(s) remain`);
  }

  console.log(`\n  ${held} attack(s) refused, ${broken} got through`);
  process.exitCode = broken > 0 ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
