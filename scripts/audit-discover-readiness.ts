// DISCOVER READINESS, ACROSS EVERY PUBLISHED ARTICLE.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/audit-discover-readiness.ts
//
// Reports what OUR pages fail against Google's own documented requirements.
// It cannot and does not predict placement. Writes nothing.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { assessDiscoverReadiness, summariseReadiness, type ArticleForReadiness } from "../src/lib/seo/discover-readiness.ts";

loadEnvLocal();
const GRAPHIC_ROLES = new Set(["diagram", "chart", "comparison_graphic", "concept_render"]);

async function main(): Promise<void> {
  const db = await createAdminClient();
  const [C, CM, MA, AU, SEO] = await Promise.all([
    db.from("content_items").select("id, slug, title, status, published_at, updated_at, author_id"),
    db.from("content_media").select("content_id, media_id, role"),
    db.from("media_assets").select("id, width, height, alt_text, publication_status, asset_role, source_type"),
    db.from("author_profiles").select("id, display_name"),
    db.from("seo_metadata").select("content_id, meta_description"),
  ]);
  for (const [n, r] of [["content_items", C], ["content_media", CM], ["media_assets", MA]] as const) {
    if (r.error) throw new Error(`${n}: ${r.error.message}`);
  }

  const assets = new Map(((MA.data ?? []) as Record<string, unknown>[]).map((a) => [String(a.id), a]));
  const heroByContent = new Map<string, Record<string, unknown>>();
  for (const l of (CM.data ?? []) as Record<string, unknown>[]) {
    if (String(l.role) !== "hero") continue;
    const a = assets.get(String(l.media_id));
    if (a) heroByContent.set(String(l.content_id), a);
  }
  const authors = new Map(((AU.data ?? []) as Record<string, unknown>[]).map((a) => [String(a.id), String(a.display_name)]));
  const descs = new Map(((SEO.data ?? []) as Record<string, unknown>[]).map((s) => [String(s.content_id), s.meta_description ? String(s.meta_description) : null]));

  const rows = ((C.data ?? []) as Record<string, unknown>[]).filter((c) => String(c.status) === "published");
  const findings = rows.map((c) => {
    const h = heroByContent.get(String(c.id));
    const article: ArticleForReadiness = {
      id: String(c.id),
      slug: String(c.slug),
      title: String(c.title),
      status: String(c.status),
      publishedAt: c.published_at ? String(c.published_at) : null,
      updatedAt: c.updated_at ? String(c.updated_at) : null,
      authorName: c.author_id ? (authors.get(String(c.author_id)) ?? null) : null,
      // content_items has no excerpt/summary column — the description a preview
      // would use lives in seo_metadata.meta_description. Discovered by the
      // query failing, not by assuming.
      description: descs.get(String(c.id)) ?? null,
      hero: h
        ? {
            width: typeof h.width === "number" ? h.width : null,
            height: typeof h.height === "number" ? h.height : null,
            altText: h.alt_text ? String(h.alt_text) : null,
            publicationStatus: String(h.publication_status),
            isGraphic: GRAPHIC_ROLES.has(String(h.asset_role)) || String(h.source_type) === "tc_graphic",
          }
        : null,
    };
    return { article, finding: assessDiscoverReadiness(article) };
  });

  console.log("=".repeat(78));
  console.log(`GOOGLE DISCOVER READINESS — ${findings.length} published articles`);
  console.log("Checked against developers.google.com/search/docs/appearance/google-discover");
  console.log("This is NOT a ranking score and cannot predict placement.");
  console.log("=".repeat(78) + "\n");

  for (const [state, n] of summariseReadiness(findings.map((f) => f.finding))) {
    console.log(`  ${String(n).padStart(3)}  ${state}`);
  }

  console.log("\n--- examples ---");
  const seen = new Set<string>();
  for (const { article, finding } of findings) {
    if (seen.has(finding.state) || finding.state === "READY") continue;
    seen.add(finding.state);
    console.log(`\n  ${finding.state}   "${article.title.slice(0, 58)}"`);
    for (const p of finding.problems.slice(0, 3)) console.log(`     x ${p}`);
  }
  const ready = findings.filter((f) => f.finding.state === "READY");
  if (ready.length > 0) {
    console.log(`\n  READY   "${ready[0].article.title.slice(0, 58)}"`);
    for (const p of ready[0].finding.passes.slice(0, 4)) console.log(`     ok ${p}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
