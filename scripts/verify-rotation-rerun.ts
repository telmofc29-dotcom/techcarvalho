// PART 1 — same-day rerun must REPLACE, not accumulate.
//
// The defect this proves fixed: recording a rotation twice for one date used to
// append, because the upsert key is (rotation_date, content_id) and a second
// pass legitimately chooses different content. Live that took one day from 5
// rows to 11 with three leads.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-rotation-rerun.ts

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { selectSpotlight, type SpotlightCandidate } from "../src/lib/public/spotlight.ts";

type Db = Awaited<ReturnType<typeof createAdminClient>>;

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
}

const MS_DAY = 86_400_000;

async function buildCandidates(db: Db, now: Date): Promise<SpotlightCandidate[]> {
  const sel = await db.rpc("public_homepage_selection", { p_supporting: 8 });
  const rankPos = new Map(((sel.data ?? []) as { content_id: string }[]).map((r, i) => [r.content_id, i]));
  const { data: pubs } = await db
    .from("content_items")
    .select("id, title, slug, type, category_id, published_at")
    .eq("status", "published").not("published_at", "is", null)
    .order("published_at", { ascending: false }).limit(60);
  const { data: cats } = await db.from("taxonomy_categories").select("id, slug");
  const catById = new Map(((cats ?? []) as { id: string; slug: string }[]).map((c) => [c.id, c.slug]));
  const mem = await db.rpc("homepage_rotation_memory");
  const memory = new Map(((mem.data ?? []) as { content_id: string; last_spotlighted_at: string | null; spotlight_count: number }[]).map((m) => [m.content_id, m]));
  const { data: ov } = await db.from("homepage_overrides_active").select("content_id, mode");
  const modes = new Map(((ov ?? []) as { content_id: string; mode: string }[]).map((o) => [o.content_id, o.mode]));

  return ((pubs ?? []) as unknown as {
    id: string; title: string; slug: string; type: string | null;
    category_id: string | null; published_at: string;
  }[]).map((p) => {
    const pos = rankPos.get(p.id); const m = memory.get(p.id); const mode = modes.get(p.id);
    return {
      contentId: p.id, title: p.title, slug: p.slug, contentType: p.type,
      categorySlug: p.category_id ? (catById.get(p.category_id) ?? null) : null,
      publishedAt: p.published_at,
      baseScore: pos === undefined ? 40 : 90 - pos * 3,
      lastSpotlightedAt: m?.last_spotlighted_at ?? null,
      spotlightCount: m?.spotlight_count ?? 0,
      hasStrongMedia: false,
      pinnedLead: mode === "pin_lead", pinnedSupporting: mode === "pin_supporting",
      boosted: mode === "boost", suppressed: mode === "suppress",
    };
  });
}

/** One rotation pass, exactly as the nightly stage does it: clear, then record. */
async function runRotation(db: Db, now: Date, date: string) {
  const cleared = await db.rpc("homepage_clear_spotlight", { p_rotation_date: date });
  const candidates = await buildCandidates(db, now);
  const s = selectSpotlight({ candidates, now, supportingSlots: 4 });
  const slots = [...(s.lead ? [s.lead] : []), ...s.supporting];
  let recorded = 0;
  for (const [i, slot] of slots.entries()) {
    const r = await db.rpc("homepage_record_spotlight", {
      p_rotation_date: date, p_content_id: slot.candidate.contentId,
      p_role: slot.role, p_slot_position: i,
      p_score: Number(slot.score.toFixed(2)), p_reasons: slot.reasons,
    });
    if (r.data === "recorded") recorded++;
    else if (r.error) console.log(`      record error: ${r.error.message}`);
  }
  return { clearedRows: cleared.data ?? 0, clearError: cleared.error?.message ?? null, recorded, slots };
}

async function logFor(db: Db, date: string) {
  const { data } = await db
    .from("homepage_spotlight_log")
    .select("content_id, role, slot_position")
    .eq("rotation_date", date)
    .order("slot_position");
  return (data ?? []) as unknown as { content_id: string; role: string; slot_position: number }[];
}

async function main(): Promise<void> {
  loadEnvLocal();
  const db = await createAdminClient();
  const now = new Date();

  // The DB's clock decides the rotation date public_spotlight serves.
  const probeRow = await db.from("content_items").select("id").eq("status", "published").limit(1).single();
  const probe = await db.from("homepage_overrides")
    .insert({ content_id: (probeRow.data as { id: string }).id, mode: "suppress", note: "clock probe" })
    .select("id, created_at").single();
  const dbNow = new Date((probe.data as { created_at: string }).created_at);
  await db.from("homepage_overrides").delete().eq("id", (probe.data as { id: string }).id);
  const today = dbNow.toISOString().slice(0, 10);

  console.log("");
  console.log("=".repeat(72));
  console.log(`SAME-DAY RERUN VERIFICATION  (db date ${today})`);
  console.log("=".repeat(72));

  const before = await logFor(db, today);
  console.log(`rows for ${today} before: ${before.length}\n`);

  // ---- exposure baseline, so a retry must not inflate it -----------------
  const memBefore = new Map(
    (((await db.rpc("homepage_rotation_memory")).data ?? []) as
      { content_id: string; spotlight_count: number }[]).map((m) => [m.content_id, m.spotlight_count])
  );

  console.log("RUN 1");
  const r1 = await runRotation(db, now, today);
  check("clear function is deployed", r1.clearError === null, r1.clearError ?? "");
  console.log(`  cleared ${r1.clearedRows}, recorded ${r1.recorded}`);
  const log1 = await logFor(db, today);
  const ids1 = log1.map((r) => r.content_id);

  console.log("\nRUN 2 (immediate rerun, same date)");
  const r2 = await runRotation(db, now, today);
  console.log(`  cleared ${r2.clearedRows}, recorded ${r2.recorded}`);
  const log2 = await logFor(db, today);

  console.log("\nASSERTIONS");
  check("rerun cleared the previous rotation", r2.clearedRows === log1.length,
    `cleared ${r2.clearedRows}, previous had ${log1.length}`);
  check("row count did NOT accumulate", log2.length === log1.length,
    `run1=${log1.length} run2=${log2.length}`);
  check("exactly one lead", log2.filter((r) => r.role === "lead").length === 1,
    `${log2.filter((r) => r.role === "lead").length} leads`);
  check("exactly 4 supporting positions", log2.filter((r) => r.role === "supporting").length === 4,
    `${log2.filter((r) => r.role === "supporting").length}`);
  const positions = log2.map((r) => r.slot_position);
  check("no duplicate slot positions", new Set(positions).size === positions.length,
    positions.join(","));
  check("no duplicate content in one rotation",
    new Set(log2.map((r) => r.content_id)).size === log2.length);
  check("positions are contiguous from 0", positions.join(",") === positions.map((_, i) => i).join(","),
    positions.join(","));

  // ---- exposure must not inflate from a retry ---------------------------
  const memAfter = new Map(
    (((await db.rpc("homepage_rotation_memory")).data ?? []) as
      { content_id: string; spotlight_count: number }[]).map((m) => [m.content_id, m.spotlight_count])
  );
  const inflated = log2.filter((r) => {
    const b = memBefore.get(r.content_id) ?? 0;
    const a = memAfter.get(r.content_id) ?? 0;
    return a > b + 1; // one appearance for today is correct; two would be the retry counted twice
  });
  check("a retry did NOT inflate exposure counts", inflated.length === 0,
    inflated.map((r) => r.content_id.slice(0, 8)).join(", "));

  // ---- the public read follows the replacement --------------------------
  const live = ((await db.rpc("public_spotlight", { p_rotation_date: null })).data ?? []) as
    { content_id: string; title: string; role: string }[];
  check("public_spotlight returns exactly the replacement", live.length === log2.length,
    `live=${live.length} log=${log2.length}`);
  check("public_spotlight shows one lead", live.filter((r) => r.role === "lead").length === 1);
  const liveIds = live.map((r) => r.content_id).sort();
  check("public_spotlight content matches the log",
    liveIds.join(",") === log2.map((r) => r.content_id).sort().join(","));

  // ---- tomorrow can still produce its own rotation ----------------------
  console.log("\nNEXT-DAY ROTATION");
  const tomorrowDate = new Date(dbNow.getTime() + MS_DAY).toISOString().slice(0, 10);
  const rT = await runRotation(db, new Date(now.getTime() + MS_DAY), tomorrowDate);
  const logT = await logFor(db, tomorrowDate);
  check("tomorrow records its own rotation", logT.length === 5, `${logT.length} rows`);
  check("tomorrow has exactly one lead", logT.filter((r) => r.role === "lead").length === 1);
  const overlap = logT.filter((r) => ids1.includes(r.content_id)).length;
  check("tomorrow brings forward different content", overlap < logT.length,
    `${overlap}/${logT.length} carried over`);
  console.log(`  today -> tomorrow: ${logT.length - overlap} of ${logT.length} changed`);
  check("today's rotation is untouched by tomorrow's", (await logFor(db, today)).length === log2.length);

  // Remove the synthetic future rotation so it cannot serve tomorrow.
  const clearedT = await db.rpc("homepage_clear_spotlight", { p_rotation_date: tomorrowDate });
  check("synthetic next-day rotation removed", (clearedT.data ?? 0) === logT.length,
    `cleared ${clearedT.data}`);

  console.log("\nTODAY'S ROTATION AFTER RERUN");
  for (const r of live) {
    console.log(`  ${r.role.toUpperCase().padEnd(11)} ${r.title.slice(0, 62)}`);
  }

  console.log(`\n${passed}/${passed + failed} checks passed.`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
