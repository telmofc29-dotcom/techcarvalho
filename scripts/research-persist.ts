// PROVE RESEARCH PERSISTENCE — against the real production database.
//
// engine_add_evidence is now applied, so the research stage can finally record
// what it finds. This runs a real research cycle for a topic, persists the
// evidence, and then runs the SAME cycle again to prove the second pass adds
// nothing.
//
// IDEMPOTENCY IS THE POINT. `on conflict (discovery_id, url) do nothing` is
// what stops a nightly stage from growing the evidence table without bound, and
// an engine that re-attaches the same five URLs every night would inflate every
// corroboration count it later reads. Proving run 2 creates zero rows is
// therefore proving the evidence model stays honest over time.
//
//   npx tsx scripts/research-persist.ts "iPhone 18" --category smartphones
//   npx tsx scripts/research-persist.ts "iPhone 18" --category smartphones --cleanup

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { buildCorpus } from "../src/lib/engine/research/feed-index.ts";
import { researchDiscovery } from "../src/lib/engine/research/research-pipeline.ts";
import {
  primarySubject,
  categoryForText,
  subjectDomainsForText,
} from "../src/lib/engine/research/entity-model.ts";
import { buildDedupeKey } from "../src/lib/engine/dedupe.ts";

type Db = Awaited<ReturnType<typeof createAdminClient>>;

async function evidenceFor(db: Db, discoveryId: string) {
  const { data, error } = await db
    .from("engine_discovery_evidence")
    .select("id, url, publisher, claim_status, trust_level, originates_from_url, origin_examined, excerpt")
    .eq("discovery_id", discoveryId)
    .order("url");
  if (error) throw new Error(`evidence read: ${error.message}`);
  return data ?? [];
}

async function main(): Promise<void> {
  loadEnvLocal();
  const args = process.argv.slice(2);
  const topic = args.find((a) => !a.startsWith("--")) ?? "iPhone 18";
  const catFlag = args.indexOf("--category");
  const category = catFlag >= 0 ? args[catFlag + 1] : categoryForText(topic);
  const cleanup = args.includes("--cleanup");

  const db = await createAdminClient();

  console.log("");
  console.log("=".repeat(72));
  console.log(`RESEARCH PERSISTENCE: ${topic}`);
  console.log("=".repeat(72));

  // ---- 0. Is the RPC actually deployed? --------------------------------
  const probe = await db.rpc("engine_add_evidence", {
    p_discovery_id: "00000000-0000-0000-0000-000000000000",
    p_url: "https://example.invalid/probe",
  });
  if (probe.error && /PGRST202|could not find the function/i.test(probe.error.message)) {
    console.log("engine_add_evidence is NOT deployed. Nothing below can run.");
    process.exitCode = 1;
    return;
  }
  console.log(`RPC engine_add_evidence : deployed (probe returned ${JSON.stringify(probe.data ?? probe.error?.message)})`);

  // ---- 1. Ensure a discovery exists ------------------------------------
  // Created through the engine's own RPC, not by direct insert, so this is the
  // same row shape the nightly discovery stage produces.
  const dedupeKey = buildDedupeKey({ title: topic, discoveryType: "technology_news" });
  const { data: existing } = await db
    .from("engine_discoveries")
    .select("id, title, claim_status, state")
    .eq("title", topic)
    .order("first_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let discoveryId: string;
  if (existing) {
    discoveryId = (existing as { id: string }).id;
    console.log(`Discovery                : reusing existing ${discoveryId}`);
  } else {
    const { data: created, error: cErr } = await db.rpc("engine_upsert_discovery", {
      p_dedupe_key: dedupeKey,
      p_title: topic,
      p_summary: `Research subject: ${topic}`,
      p_discovery_type: "technology_news",
      p_category_slug: category,
      p_claim_status: "unverified",
      p_confidence: 0,
      p_source_url: null,
      p_publisher: null,
      p_trust_level: "secondary",
    });
    if (cErr) {
      console.log(`Could not create discovery: ${cErr.message}`);
      process.exitCode = 1;
      return;
    }
    // Look up by TITLE, not by the key we passed: engine_upsert_discovery
    // normalises the dedupe key itself, so the value we sent is not necessarily
    // the value stored. Selecting on our own input found nothing and read as
    // "creation failed" when the row existed perfectly well.
    const { data: row, error: rErr } = await db
      .from("engine_discoveries")
      .select("id")
      .eq("title", topic)
      .order("first_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rErr || !row) {
      console.log(`Discovery created (${created}) but could not be read back: ${rErr?.message ?? "no row"}`);
      process.exitCode = 1;
      return;
    }
    discoveryId = (row as { id: string }).id;
    console.log(`Discovery                : created ${discoveryId} (${created})`);
  }

  // ---- 2. Research, twice ----------------------------------------------
  const corpus = await buildCorpus(category);
  console.log(`Sources read             : ${corpus.read.length} (${corpus.read.join(", ")})`);
  console.log(`Corpus                   : ${corpus.items.length} items`);

  const subject = primarySubject(topic);
  console.log(`Subject                  : ${subject?.organisation.name ?? "none"}`);

  async function runOnce(label: string) {
    const before = await evidenceFor(db, discoveryId);
    const result = researchDiscovery({
      title: topic,
      subjectDomains: subjectDomainsForText(topic),
      aboutUnreleasedProduct: true,
      corpus: corpus.items,
      sourcesAttempted: corpus.attempted,
      sourcesRead: corpus.read,
      sourcesFailed: corpus.failed,
    });

    let created = 0;
    let deduped = 0;
    let rejected = 0;
    for (const m of result.matches) {
      if (!m.item.link) continue;
      const node = result.lineage.nodes.find((n) => n.url === m.item.link);
      const { data: outcome, error } = await db.rpc("engine_add_evidence", {
        p_discovery_id: discoveryId,
        p_url: m.item.link,
        p_publisher: m.item.source.organisation,
        p_claim_status: "unverified",
        p_trust_level: "secondary",
        p_excerpt: (m.item.summary ?? m.item.title).slice(0, 2000),
        p_originates_from_url: node?.role === "derived" ? (node.attributedOrigin ?? null) : null,
        p_origin_examined: true,
      });
      if (error) {
        console.log(`    RPC ERROR: ${error.message}`);
        rejected++;
      } else if (outcome === "created") created++;
      else if (outcome === "deduped") deduped++;
      else rejected++;
    }

    const after = await evidenceFor(db, discoveryId);
    console.log("");
    console.log(`${label}`);
    console.log(`    matches offered      : ${result.matches.length}`);
    console.log(`    created              : ${created}`);
    console.log(`    unchanged (deduped)  : ${deduped}`);
    console.log(`    rejected             : ${rejected}`);
    console.log(`    evidence rows before : ${before.length}`);
    console.log(`    evidence rows after  : ${after.length}`);
    console.log(`    independent origins  : ${result.lineage.independentOrigins}`);
    return { result, before, after, created, deduped };
  }

  const run1 = await runOnce("RUN 1");
  const run2 = await runOnce("RUN 2");

  // ---- 3. Inspect what actually persisted -------------------------------
  console.log("");
  console.log("PERSISTED EVIDENCE");
  for (const e of run2.after) {
    const row = e as Record<string, unknown>;
    console.log(`    ${String(row.publisher ?? "?").padEnd(20)} ${String(row.url).slice(0, 74)}`);
    console.log(
      `        claim_status=${row.claim_status}  trust=${row.trust_level}  ` +
        `origin_examined=${row.origin_examined}  originates_from=${row.originates_from_url ?? "(none — independent)"}`
    );
  }

  // ---- 4. Verdicts -------------------------------------------------------
  console.log("");
  console.log("VERDICTS");
  const grew = run2.after.length - run1.after.length;
  console.log(`    Evidence persisted            : ${run2.after.length > 0 ? "YES" : "NO"}`);
  console.log(`    Publisher recorded            : ${run2.after.every((e) => (e as { publisher: string | null }).publisher) ? "YES" : "PARTIAL"}`);
  console.log(`    Lineage recorded              : ${run2.after.some((e) => (e as { originates_from_url: string | null }).originates_from_url) ? "YES (a derivative was marked)" : "no derivative found this run"}`);
  console.log(`    Run 2 created new rows        : ${run2.created}`);
  console.log(`    Row count change on run 2     : ${grew}`);
  console.log(`    IDEMPOTENT                    : ${run2.created === 0 && grew === 0 ? "YES" : "NO — investigate"}`);

  if (cleanup) {
    await db.from("engine_discovery_evidence").delete().eq("discovery_id", discoveryId);
    await db.from("engine_discoveries").delete().eq("id", discoveryId);
    console.log("");
    console.log("Cleaned up: discovery and its evidence removed.");
  } else {
    console.log("");
    console.log(`Left in place. Discovery id: ${discoveryId}`);
    console.log("Re-run with --cleanup to remove.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
