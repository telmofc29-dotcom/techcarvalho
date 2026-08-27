// STORY MOMENTUM, AGAINST THE REAL DISCOVERY TIMELINE.
//
// Groups production engine_discoveries by the development they describe, reads
// WHEN each independent origin first carried it, and asks how each story is
// moving. Nothing is invented: every input is a row this site already stores.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-story-momentum.ts
//
// It writes nothing.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { assessMomentum, compareForQueue, type OriginSighting, type MomentumState } from "../src/lib/engine/story-momentum.ts";
import { classifySignificance } from "../src/lib/engine/opportunity-score.ts";
import { compareModelIdentity } from "../src/lib/engine/model-identity.ts";
import { titleSimilarity } from "../src/lib/engine/dedupe.ts";

loadEnvLocal();

// WHAT COUNTS AS AN INDEPENDENT ORIGIN, AND WHAT DOES NOT.
//
// The first version of this script assumed each engine_discoveries row was one
// independent origin and grouped rows by title similarity. Run against
// production it produced this:
//
//   [ACCELERATING] Hello Developer: April 2026
//      4 new independent origins in the last 3 days
//
// Both halves were wrong. Those rows carry the dedupe keys
// "2026-developer-hello-july" and "...-may" — DIFFERENT developments that title
// similarity merged — and none of them was corroborated by anybody; they are
// separate items from one vendor feed. The script was manufacturing
// corroboration, which is the one thing a momentum signal must never do.
//
// The engine already knows both answers and neither needed inventing:
//
//   dedupe_key                        the engine's OWN notion of one development
//   engine_discovery_evidence         one row per source that carried it,
//                                     with source_id and publisher
//
// So a development is a dedupe_key, and an origin is a distinct publisher on its
// evidence. A vendor posting five items to its own blog is one origin.

async function main(): Promise<void> {
  const db = await createAdminClient();
  const [D, C, E] = await Promise.all([
    // THE REAL COLUMNS. engine_discoveries has no url and no discovered_at; it
    // records first_seen_at, last_seen_at and sighting_count, which is a better
    // timeline than a single timestamp — it is literally when this development
    // was first and most recently seen. Found by the query failing.
    db
      .from("engine_discoveries")
      .select("id, title, first_seen_at, last_seen_at, sighting_count, manufacturer_id, discovery_type")
      .order("first_seen_at", { ascending: false })
      .limit(2000),
    db.from("content_items").select("title, status"),
    db.from("engine_discovery_evidence").select("discovery_id, source_id, publisher, retrieved_at, originates_from_url"),
  ]);
  if (D.error) throw new Error(`engine_discoveries: ${D.error.message}`);

  const rows = ((D.data ?? []) as unknown as Record<string, unknown>[]).filter((d) => d.title && d.first_seen_at);
  const published = ((C.data ?? []) as unknown as Record<string, unknown>[])
    .filter((c) => String(c.status) === "published")
    .map((c) => String(c.title));

  console.log("=".repeat(78));
  console.log(`STORY MOMENTUM — ${rows.length} real discoveries`);
  console.log("Signals used: origin count, WHEN each origin first appeared, first-party");
  console.log("confirmation, significance, coverage gap. No trends, volume or traffic.");
  console.log("=".repeat(78));

  // ONE DEVELOPMENT = ONE dedupe_key. That is the engine's own answer and it
  // already distinguishes "hello-may" from "hello-july"; title similarity does
  // not, and merging them invented momentum out of two unrelated posts.
  if (E.error) throw new Error(`engine_discovery_evidence: ${E.error.message}`);
  const evidenceByDiscovery = new Map<string, Record<string, unknown>[]>();
  for (const e of (E.data ?? []) as unknown as Record<string, unknown>[]) {
    const k = String(e.discovery_id);
    evidenceByDiscovery.set(k, [...(evidenceByDiscovery.get(k) ?? []), e]);
  }

  type Group = { headline: string; sightings: OriginSighting[] };
  const byKey = new Map<string, Group>();
  for (const d of rows) {
    const key = String(d.dedupe_key ?? d.id);
    const group = byKey.get(key) ?? { headline: String(d.title), sightings: [] };

    // An ORIGIN is a distinct publisher that carried it. With no evidence rows
    // there is no corroboration to claim, so the development contributes one
    // origin — itself — rather than one per row.
    const evidence = evidenceByDiscovery.get(String(d.id)) ?? [];
    if (evidence.length === 0) {
      group.sightings.push({ origin: `discovery:${key}`, firstSeen: new Date(String(d.first_seen_at)) });
    } else {
      for (const e of evidence) {
        group.sightings.push({
          origin: String(e.publisher ?? e.source_id ?? "unknown"),
          firstSeen: new Date(String(e.retrieved_at ?? d.first_seen_at)),
          firstParty: e.originates_from_url === true,
        });
      }
    }
    byKey.set(key, group);
  }
  const groups = [...byKey.values()];

  const now = new Date();
  const assessed = groups.map((g) => {
    const sig = classifySignificance(g.headline);
    const covered = published.some(
      (p) => titleSimilarity(p, g.headline) >= 0.42 && compareModelIdentity(p, g.headline).sameModel
    );
    return {
      headline: g.headline,
      significance: sig.kind,
      m: assessMomentum({
        sightings: g.sightings,
        // "Significant" means hardware or silicon or a platform release — not
        // commerce, not corporate admin. That is classifySignificance's own
        // vocabulary, not a second opinion invented here.
        significant: ["flagship_hardware", "core_silicon", "platform_software", "product_variant"].includes(sig.kind),
        coverageGap: !covered,
        now,
      }),
    };
  });

  const counts = new Map<MomentumState, number>();
  for (const a of assessed) counts.set(a.m.state, (counts.get(a.m.state) ?? 0) + 1);
  console.log(`\n  developments after grouping: ${groups.length}`);
  for (const state of ["MAJOR", "ACCELERATING", "EMERGING", "STABLE", "STALE"] as MomentumState[]) {
    console.log(`  ${String(counts.get(state) ?? 0).padStart(5)}  ${state}`);
  }

  const queue = assessed
    .map((a) => ({ ...a, momentum: a.m.state, score: a.m.origins * 10, entityTier: null }))
    .sort(compareForQueue);

  console.log("\n--- what would reach the top of Owner Today ---");
  for (const a of queue.slice(0, 8)) {
    console.log(`\n  [${a.m.state}] ${a.headline.slice(0, 66)}`);
    console.log(`     ${a.m.reasons[0]}`);
    if (a.m.reasons[1]) console.log(`     ${a.m.reasons[1]}`);
  }

  // ---- the property that matters ---------------------------------------
  //
  // A story that has stopped must never outrank one that is moving, however
  // significant or famous. Measured, not asserted.
  const movingBelowStill = queue.findIndex((a) => a.m.state === "STALE" || a.m.state === "STABLE");
  const firstMovingAfter = queue.findIndex(
    (a, i) => i > movingBelowStill && movingBelowStill >= 0 && (a.m.state === "MAJOR" || a.m.state === "ACCELERATING")
  );
  console.log(
    `\n  a still story ranked above a moving one: ${firstMovingAfter >= 0 ? `YES at ${firstMovingAfter}` : "no"}  (must be no)`
  );
  if (firstMovingAfter >= 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
