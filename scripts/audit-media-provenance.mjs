// Read-only audit of the two media rights constraints.
//
// Answers three questions that only real data can answer:
//   1. Does any row CURRENTLY violate
//      media_assets_external_verified_needs_provenance? (Should be none. A row
//      that does needs human review — never invent provenance to silence it.)
//   2. Which rows are verified ONLY because license + creator are set, and so
//      would fall below the threshold if either were blanked? These are the rows
//      the pre-flight check in updateMediaAsset now protects.
//   3. Which rows would lose asset_role or licence_permits_modification to a
//      full-row overwrite? These are what PATCH semantics now protect.
//
// Usage:
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... node scripts/audit-media-provenance.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const { error } = await db.auth.signInWithPassword({
  email: process.env.TC_ADMIN_EMAIL,
  password: process.env.TC_ADMIN_PASSWORD,
});
if (error) { console.error("auth:", error.message); process.exit(1); }

const { data, error: qErr } = await db
  .from("media_assets")
  .select("id, alt_text, created_at, source_type, rights_status, owned, license, creator, attribution, source_url, asset_role, licence_permits_modification, publication_status")
  .order("created_at", { ascending: false });
if (qErr) { console.error("query:", qErr.message); process.exit(1); }

// The constraint, exactly as defined in
// supabase/migrations/20260822_media_provenance_evidence.sql.
const satisfies = (r) =>
  r.rights_status !== "verified" ||
  r.owned === true ||
  r.source_type === "staff_photograph" ||
  r.source_type === "tc_graphic" ||
  (r.source_url != null && r.license != null && (r.creator != null || r.attribution != null));

console.log("total assets:", data.length);

const violating = data.filter((r) => !satisfies(r));
console.log("\n=== CURRENTLY VIOLATING (should be none) ===", violating.length);
for (const r of violating) console.log(" ", r.id, JSON.stringify({ st: r.source_type, rs: r.rights_status, owned: r.owned }));

// What the provenance form would write back if saved untouched. It omits
// asset_role and licence_permits_modification entirely, so those become null;
// every other field round-trips from its defaultValue.
const afterProvenanceSave = (r) => ({ ...r, asset_role: null, licence_permits_modification: null });

// What "Save changes" (readPrimaryFields) writes: media_type, alt_text, width,
// height, license, creator. If the inputs are empty they become null.
const afterPrimarySaveEmptyed = (r) => ({ ...r, license: null, creator: null });

const brokenByProvenance = data.filter((r) => satisfies(r) && !satisfies(afterProvenanceSave(r)));
const brokenByPrimary = data.filter((r) => satisfies(r) && !satisfies(afterPrimarySaveEmptyed(r)));
const losesAssetRole = data.filter((r) => r.asset_role != null);
const losesModPerm = data.filter((r) => r.licence_permits_modification != null);

console.log("\n=== WOULD BE REJECTED by a no-op 'Save provenance' ===", brokenByProvenance.length);
console.log("=== WOULD BE REJECTED if 'Save changes' blanked license/creator ===", brokenByPrimary.length);
for (const r of brokenByPrimary.slice(0, 10))
  console.log("  ", r.id, JSON.stringify({ st: r.source_type, rs: r.rights_status, owned: r.owned, lic: r.license, cre: r.creator }));

console.log("\n=== SILENT DATA LOSS from a no-op 'Save provenance' ===");
console.log("  rows that would lose asset_role:", losesAssetRole.length);
console.log("  rows that would lose licence_permits_modification:", losesModPerm.length);

console.log("\n=== 6 MOST RECENT ASSETS ===");
for (const r of data.slice(0, 6))
  console.log(
    "  " + r.created_at.slice(0, 19),
    JSON.stringify({
      id: r.id.slice(0, 8), st: r.source_type, rs: r.rights_status, owned: r.owned,
      role: r.asset_role, mod: r.licence_permits_modification,
      lic: r.license, cre: r.creator, url: r.source_url ? "set" : null,
      alt: (r.alt_text ?? "").slice(0, 30),
    })
  );
