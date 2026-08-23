// Read-only measurement behind docs/thin-page-triage.md.
//
// WHY A SCRIPT AND NOT A PASTED TABLE
// -----------------------------------
// The triage document names 51 URLs and recommends an action for each. A list
// like that is only worth anything if the numbers under it can be re-derived,
// so this prints exactly the columns the document carries and nothing else.
// Re-run it before acting on the document; if a row has moved, the document is
// stale and the row is right.
//
// It writes nothing. Every query checks its own error BY NAME and throws —
// no `?? []` anywhere, because an empty array from a failed read is how this
// project once published a fabricated measurement.
//
// Usage:
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/audit-thin-pages.ts
//   ... --bodies      also dump each under-floor body, for reading them
//   ... --slug=<slug> dump one piece in full

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { countBodyWords } from "../src/lib/content/reading-time.ts";
import { floorFor } from "../src/lib/content/quality-inventory.ts";

type Res<T> = { data: T | null; error: { message: string } | null };

function must<T>(label: string, res: Res<T>): T {
  if (res.error) throw new Error(`audit-thin-pages: reading ${label} failed — ${res.error.message}`);
  if (res.data === null) throw new Error(`audit-thin-pages: ${label} returned null rather than rows`);
  return res.data;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const supabase = await createAdminClient();

  const wantBodies = process.argv.includes("--bodies");
  const slugArg = process.argv.find((a) => a.startsWith("--slug="))?.slice("--slug=".length);

  const content = must(
    "content_items",
    await supabase
      .from("content_items")
      .select("id, slug, title, type, body, status, locale, published_at, category_id, primary_query")
      .eq("status", "published")
  );

  const sources = must("source_records", await supabase.from("source_records").select("content_id, reliability_tier"));
  const rels = must("content_relationships", await supabase.from("content_relationships").select("content_id, related_content_id, relationship_type"));
  const links = must("content_products", await supabase.from("content_products").select("content_id, product_id"));
  const seo = must("seo_metadata", await supabase.from("seo_metadata").select("content_id, noindex"));
  const cats = must("taxonomy_categories", await supabase.from("taxonomy_categories").select("id, slug"));

  const catSlug = new Map(cats.map((c) => [c.id, c.slug]));
  const bySlug = new Map(content.map((c) => [c.slug, c]));
  const titleById = new Map(content.map((c) => [c.id, c.title]));

  const srcCount = new Map<string, number>();
  const primaryCount = new Map<string, number>();
  for (const s of sources) {
    if (!s.content_id) continue;
    srcCount.set(s.content_id, (srcCount.get(s.content_id) ?? 0) + 1);
    if (s.reliability_tier === "primary") primaryCount.set(s.content_id, (primaryCount.get(s.content_id) ?? 0) + 1);
  }

  const inbound = new Map<string, string[]>();
  const outbound = new Map<string, string[]>();
  for (const r of rels) {
    if (r.content_id) outbound.set(r.content_id, [...(outbound.get(r.content_id) ?? []), r.related_content_id ?? "?"]);
    if (r.related_content_id) inbound.set(r.related_content_id, [...(inbound.get(r.related_content_id) ?? []), r.content_id ?? "?"]);
  }

  const products = new Map<string, number>();
  for (const l of links) {
    if (!l.content_id) continue;
    products.set(l.content_id, (products.get(l.content_id) ?? 0) + 1);
  }

  const noindexed = new Set(seo.filter((s) => s.noindex && s.content_id).map((s) => s.content_id!));

  if (slugArg) {
    const item = bySlug.get(slugArg);
    if (!item) throw new Error(`No published content_item with slug ${slugArg}`);
    console.log(`# ${item.title}\n# type=${item.type} words=${countBodyWords(item.body)} floor=${floorFor(item.type)}\n`);
    console.log(item.body ?? "(no body)");
    return;
  }

  const rows = content
    .map((c) => {
      const words = countBodyWords(c.body);
      const floor = floorFor(c.type);
      return {
        slug: c.slug,
        id: c.id,
        title: c.title,
        type: c.type,
        words,
        floor,
        deficit: floor - words,
        sources: srcCount.get(c.id) ?? 0,
        primary: primaryCount.get(c.id) ?? 0,
        inbound: (inbound.get(c.id) ?? []).length,
        outbound: (outbound.get(c.id) ?? []).length,
        products: products.get(c.id) ?? 0,
        category: c.category_id ? (catSlug.get(c.category_id) ?? "?") : "-",
        noindex: noindexed.has(c.id),
        body: c.body,
      };
    })
    .sort((a, b) => b.deficit - a.deficit);

  const under = rows.filter((r) => r.words < r.floor);

  console.log(`published=${content.length} underFloor=${under.length} noindexed=${rows.filter((r) => r.noindex).length}`);
  console.log(
    `\n${"slug".padEnd(52)}${"type".padEnd(16)}${"words".padStart(6)}${"floor".padStart(6)}${"in".padStart(4)}${"out".padStart(4)}${"src".padStart(4)}${"pri".padStart(4)}${"prod".padStart(5)}  category  noindex`
  );
  for (const r of under) {
    console.log(
      r.slug.padEnd(52) +
        r.type.padEnd(16) +
        String(r.words).padStart(6) +
        String(r.floor).padStart(6) +
        String(r.inbound).padStart(4) +
        String(r.outbound).padStart(4) +
        String(r.sources).padStart(4) +
        String(r.primary).padStart(4) +
        String(r.products).padStart(5) +
        "  " + r.category +
        (r.noindex ? "  NOINDEX" : "")
    );
  }

  // Who links IN to each under-floor piece — the "strong inbound links" test in
  // the triage. Printed as titles so it is readable without a second lookup.
  console.log("\n--- inbound edges (content graph) ---");
  for (const r of under) {
    const froms = (inbound.get(r.id) ?? []).map((id) => titleById.get(id) ?? id);
    console.log(`${r.slug}  <-  ${froms.length === 0 ? "(none)" : froms.join(" | ")}`);
  }

  if (wantBodies) {
    console.log("\n--- bodies of under-floor pieces ---");
    for (const r of under) {
      console.log(`\n===== ${r.slug} (${r.type}, ${r.words}/${r.floor}) =====`);
      console.log(r.body ?? "(no body)");
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
