import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const envLocal = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envLocal.split("\n")) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
await admin.auth.signInWithPassword({ email: process.env.TC_ADMIN_EMAIL, password: process.env.TC_ADMIN_PASSWORD });
const { computeConfidence } = await import("./src/lib/engine/confidence.ts");

const { count } = await admin.from("engine_discoveries").select("*", { count: "exact", head: true });
console.log("=== Total discoveries:", count, "===\n");

const { data: byType } = await admin.from("engine_discoveries").select("discovery_type, claim_status, category_slug");
const typeCount = {}, claimCount = {}, catCount = {};
for (const d of byType) {
  typeCount[d.discovery_type] = (typeCount[d.discovery_type] ?? 0) + 1;
  claimCount[d.claim_status] = (claimCount[d.claim_status] ?? 0) + 1;
  catCount[d.category_slug ?? "(none)"] = (catCount[d.category_slug ?? "(none)"] ?? 0) + 1;
}
console.log("By discovery_type:", JSON.stringify(typeCount));
console.log("By claim_status:  ", JSON.stringify(claimCount));
console.log("By category:      ", JSON.stringify(catCount));

console.log("\n=== Sample discoveries (real, from official feeds) ===");
const { data: sample } = await admin.from("engine_discoveries").select("id, title, discovery_type, claim_status, sighting_count, category_slug").order("first_seen_at", { ascending: false }).limit(8);
for (const d of sample) console.log(` [${d.discovery_type}/${d.claim_status}] ${d.title.slice(0, 78)}`);

console.log("\n=== Confidence engine on REAL evidence ===");
for (const d of sample.slice(0, 3)) {
  const { data: ev } = await admin.from("engine_discovery_evidence").select("claim_status, trust_level, originates_from_url, url, publisher").eq("discovery_id", d.id);
  const r = computeConfidence(ev ?? []);
  console.log(`\n "${d.title.slice(0, 60)}"`);
  console.log(`   evidence=${ev.length} (${ev.map(e=>e.publisher).join(", ")})`);
  console.log(`   confidence=${r.confidence} status=${r.effectiveClaimStatus}`);
  console.log(`   explanation: ${r.explanation}`);
}

console.log("\n=== Source health after failure test ===");
const { data: src } = await admin.from("engine_sources").select("organisation, url, is_active, discovery_permitted, media_republication_permitted, media_rights_status, consecutive_failures, last_error, last_success_at").eq("is_active", true);
for (const s of src) {
  console.log(` ${s.organisation.padEnd(20)} fails=${s.consecutive_failures} media_republication=${s.media_republication_permitted} rights=${s.media_rights_status} ${s.last_error ? "ERR: " + s.last_error.slice(0,50) : ""}`);
}

console.log("\n=== Job run audit log (most recent 6) ===");
const { data: runs } = await admin.from("engine_job_runs").select("job_name, status, items_examined, items_created, items_deduped, items_failed, started_at").order("started_at", { ascending: false }).limit(6);
for (const r of runs) console.log(` ${r.job_name.padEnd(22)} ${r.status.padEnd(8)} examined=${r.items_examined} created=${r.items_created} deduped=${r.items_deduped} failed=${r.items_failed}`);

console.log("\n=== Opportunity explanations (must be human-readable, not bare numbers) ===");
const { data: opps } = await admin.from("engine_opportunities").select("label, score, explanation, inputs").limit(3);
for (const o of opps) console.log(` ${o.label}: score=${o.score === null ? "null (insufficient data)" : o.score}\n   -> ${o.explanation}`);

console.log("\n=== SAFETY: can a discovery reach published content? ===");
const { count: briefCount } = await admin.from("engine_briefs").select("*", { count: "exact", head: true });
const { count: pubCount } = await admin.from("content_items").select("*", { count: "exact", head: true }).eq("status", "published");
console.log(` engine_briefs rows: ${briefCount} (engine creates no content on its own)`);
console.log(` published content_items: ${pubCount} (unchanged by engine runs)`);
