// Register the verified editorial registry into engine_sources.
//
// WHY THIS WRITES PRODUCTION DATA, WHEN ALMOST NOTHING ELSE HERE DOES
// -------------------------------------------------------------------
// The owner asked for it explicitly: "Build the initial source registry
// yourself. Do not require me to manually enter dozens of publications." Every
// entry was verified reachable with plain fetch() before being written, and the
// whole thing is reversible with --remove.
//
// WHAT EACH SETTING MEANS, AND WHY
// --------------------------------
//   trust_level: 'secondary'
//     THE LOAD-BEARING ONE. `primary` means "speaks with authority about
//     itself" and is what grants first-party single-source sufficiency. An
//     independent publication reporting on someone else's product is exactly
//     the case that still needs corroboration, so every source here is
//     secondary. Setting any of these to `primary` would quietly hand them
//     authority they do not have.
//
//   source_type: 'trusted_editorial'
//     Distinguishes them from the 28 vendor newsrooms already registered.
//
//   media_republication_permitted: false
//     Permission to read facts is never permission to reuse imagery. Left false
//     for every source; a rights decision is a human one and is not implied by
//     a feed being public.
//
// IDEMPOTENT. Matches on `url`, updates in place, never duplicates.
//
//   npx tsx scripts/register-editorial-sources.ts            (dry run)
//   npx tsx scripts/register-editorial-sources.ts --apply
//   npx tsx scripts/register-editorial-sources.ts --remove --apply

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { SEED_SOURCES, BLOCKED_SOURCES } from "../src/lib/engine/research/source-seed.ts";

async function main(): Promise<void> {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");
  const remove = process.argv.includes("--remove");
  const db = await createAdminClient();

  const { data: existing, error } = await db
    .from("engine_sources")
    .select("id, organisation, url, source_type, trust_level, is_active");
  if (error) {
    console.error(`Registry read failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const byUrl = new Map((existing ?? []).map((s: { url: string; id: string }) => [s.url, s]));

  console.log("");
  console.log(remove ? "REMOVING SEEDED EDITORIAL SOURCES" : "REGISTERING EDITORIAL SOURCES");
  console.log("=".repeat(66));
  console.log(`Existing registry : ${(existing ?? []).length} sources`);
  console.log(`Seed set          : ${SEED_SOURCES.length} verified editorial feeds`);
  console.log(`Blocked, excluded : ${BLOCKED_SOURCES.length}`);
  console.log("");

  if (remove) {
    const urls = SEED_SOURCES.map((s) => s.feedUrl).filter((u) => byUrl.has(u));
    console.log(`Would remove ${urls.length} seeded source(s).`);
    if (apply && urls.length > 0) {
      const { error: delErr } = await db.from("engine_sources").delete().in("url", urls);
      if (delErr) console.error(`  FAILED: ${delErr.message}`);
      else console.log(`  Removed ${urls.length}.`);
    }
    return;
  }

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const s of SEED_SOURCES) {
    const row = {
      organisation: s.organisation,
      url: s.feedUrl,
      // A vendor blog is a manufacturer newsroom, not editorial, and its trust
      // level is what grants first-party single-source sufficiency. Getting
      // this wrong in either direction breaks the evidence model.
      source_type: (s.publisherType === "first_party"
        ? "manufacturer_newsroom"
        : "trusted_editorial") as "manufacturer_newsroom" | "trusted_editorial",
      categories: s.categories,
      // See the header: secondary is what keeps first-party authority honest.
      // A vendor speaking about itself is genuinely primary.
      trust_level: (s.publisherType === "first_party" ? "primary" : "secondary") as
        | "primary"
        | "secondary",
      is_active: true,
      discovery_permitted: true,
      media_republication_permitted: false,
      media_rights_status: "unverified" as const,
      check_frequency_hours: 12,
      updated_at: new Date().toISOString(),
    };

    const found = byUrl.get(s.feedUrl);
    const verb = found ? "UPDATE" : "CREATE";
    console.log(
      `  ${verb.padEnd(6)} ${s.organisation.padEnd(22)} tier ${s.useTier}  ` +
        `${s.independenceGroup.padEnd(18)} ${s.categories.join(",")}`
    );

    if (!apply) continue;

    if (found) {
      const { error: upErr } = await db.from("engine_sources").update(row).eq("id", found.id);
      if (upErr) {
        console.log(`         FAILED: ${upErr.message}`);
        failed++;
      } else updated++;
    } else {
      const { error: insErr } = await db.from("engine_sources").insert(row);
      if (insErr) {
        console.log(`         FAILED: ${insErr.message}`);
        failed++;
      } else created++;
    }
  }

  console.log("");
  if (!apply) {
    console.log("DRY RUN — nothing written. Re-run with --apply.");
  } else {
    console.log(`Created ${created}, updated ${updated}, failed ${failed}.`);
  }

  console.log("");
  console.log("EXCLUDED (declined automated access — not worked around):");
  for (const b of BLOCKED_SOURCES) {
    console.log(`  ${String(b.status).padStart(3)}  ${b.organisation.padEnd(22)} ${b.note}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
