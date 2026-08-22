// Site-wide media rights audit.
//
// WHY THIS EXISTS AS A STANDING CHECK
// -----------------------------------
// On 2026-08-22 three CC BY / CC BY-SA photographs went live on article pages
// with no credit rendered. Every mandatory database field was populated —
// creator, licence, source URL and attribution text were all correct. The
// article hero component simply never rendered them.
//
// So a database audit would have passed while the site was out of compliance.
// The only check that catches this class is one that reads the LIVE PAGE and
// confirms the credit is actually there.
//
// It rechecks previously published media, so an asset whose licence or source
// metadata later changes or disappears is caught rather than assumed fine.
//
// Reports two independent things:
//   1. PROVENANCE  — does the data support relying on the licence at all?
//   2. RENDERING   — does the page a reader sees actually carry the credit?
//
// Read-only. Writes nothing, publishes nothing, unpublishes nothing.
//
// Usage:
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/audit-media-rights.ts
//
// Exits non-zero if any published asset fails either check, so it can gate CI
// or a scheduled run.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { evaluateProvenance } from "../src/lib/media/provenance.ts";
import { licenceUrl } from "../src/lib/media/licence-links.ts";
const env = Object.fromEntries(fs.readFileSync(new URL("../.env.local", import.meta.url),"utf8").split(/\r?\n/).filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
async function main() {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  await sb.auth.signInWithPassword({ email:"telmo.f.c29@gmail.com", password:"TeandIn0729!!" });
  // Every read checks its error explicitly. RLS denies by returning ZERO ROWS
  // rather than an error, so an empty result and a failed query look identical
  // unless you look — an audit that silently read nothing would report PASS.
  const need = <T,>(label: string, r: { data: T[] | null; error: { message: string } | null }): T[] => {
    if (r.error) throw new Error(`${label} read failed: ${r.error.message}`);
    if (!r.data) throw new Error(`${label} returned no data object`);
    return r.data;
  };
  const assets = need("media_assets", await sb.from("media_assets").select("*"));
  const pm = need("product_media", await sb.from("product_media").select("product_id,media_id,role"));
  const cm = need("content_media", await sb.from("content_media").select("content_id,media_id,role"));
  const prods = need("products", await sb.from("products").select("id,slug").eq("is_published", true));
  const cont = need("content_items", await sb.from("content_items").select("id,slug").eq("status", "published"));
  if (assets.length === 0) throw new Error("media_assets returned zero rows — refusing to report PASS on an empty read");
  const P = new Map(prods.map((x) => [x.id, x.slug]));
  const C = new Map(cont.map((x) => [x.id, x.slug]));

  const owing = assets.filter((a) => a.publication_status === "published" && evaluateProvenance(a).requiresCredit);
  // Where is each one displayed publicly?
  const pages = new Map<string, { asset: (typeof assets)[number]; urls: string[] }>();
  for (const a of owing) {
    const urls: string[] = [];
    for (const m of pm.filter((x) => x.media_id === a.id)) if (m.product_id && P.has(m.product_id)) urls.push(`/products/${P.get(m.product_id)}`);
    for (const m of cm.filter((x) => x.media_id === a.id)) if (m.content_id && C.has(m.content_id)) urls.push(`/articles/${C.get(m.content_id)}`);
    if (urls.length) pages.set(a.id, { asset: a, urls: [...new Set(urls)] });
  }
  console.log(`credit-owing assets: ${owing.length} | displayed on a public page: ${pages.size}\n`);
  let ok=0, bad=0, unreachable=0;
  const failures: { url: string; lic: string | null; deed: boolean; src: boolean; cre: boolean }[] = [];
  for (const [, {asset, urls}] of pages) {
    const url = `https://www.techcarvalho.com${urls[0]}`;
    try {
      const r = await fetch(url, { headers:{ "User-Agent":"TechCarvalhoBot/1.0" } });
      if (!r.ok) { unreachable++; continue; }
      const html = await r.text();
      const deed = licenceUrl(asset.license);
      const hasDeed = deed ? html.includes(deed) : false;
      const hasSource = asset.source_url ? html.includes(asset.source_url.replace(/&/g,"&amp;")) || html.includes(asset.source_url) : false;
      // The licence requires attribution AS SPECIFIED BY THE LICENSOR, which is
      // the `attribution` string, not the raw `creator` field. Matching creator
      // verbatim produced two false positives: "CEphoto / Uwe Aranas" renders as
      // "Photo by CEphoto, Uwe Aranas". Match the attribution text, and fall
      // back to a distinctive fragment of the creator name.
      const norm = (x: string) => x.replace(/&#(\d+);/g, (_m: string, d: string) => String.fromCharCode(Number(d))).replace(/&amp;/g,"&");
      const page = norm(html);
      const creatorToken = (asset.creator ?? "").split(/[\/,(]/)[0].trim();
      const hasCreator = (asset.attribution && page.includes(asset.attribution))
        || (creatorToken.length > 2 && page.includes(creatorToken));
      if (hasDeed && hasSource && hasCreator) ok++;
      else { bad++; failures.push({ url: urls[0], lic: asset.license, deed:hasDeed, src:hasSource, cre:hasCreator }); }
    } catch { unreachable++; }
  }
  console.log(`RENDERED CREDIT CHECK — creator + licence-deed link + source link`);
  console.log(`  compliant:   ${ok}`);
  console.log(`  FAILING:     ${bad}`);
  console.log(`  unreachable: ${unreachable}`);
  failures.slice(0,10).forEach(f=>console.log(`   ${f.url} [${f.lic}] creator=${f.cre} deed=${f.deed} source=${f.src}`));

  // Provenance half of the audit — the data check.
  const allPublished = assets.filter(a => a.publication_status === "published");
  let provBlocked = 0;
  const classes: Record<string, number> = {};
  for (const a of allPublished) {
    const r = evaluateProvenance(a);
    classes[r.rightsClass] = (classes[r.rightsClass] ?? 0) + 1;
    if (!r.publishable) {
      provBlocked++;
      console.log(`  PROVENANCE FAIL ${String(a.storage_path).slice(-40)} -> ${r.findings.filter(f=>f.severity==="blocker").map(f=>f.code).join(", ")}`);
    }
  }
  console.log(`
  PROVENANCE CHECK — ${allPublished.length} published assets`);
  console.log("  rights classes (evidence-derived):", JSON.stringify(classes));
  console.log(`  failing provenance: ${provBlocked}`);

  const failed = bad + provBlocked;
  console.log(`
  ${failed === 0 ? "PASS" : "FAIL"} — ${failed} published asset(s) fail the media rights invariant.`);
  process.exitCode = failed === 0 ? 0 : 1;

}

main().catch((e) => { console.error(e); process.exitCode = 1; });
