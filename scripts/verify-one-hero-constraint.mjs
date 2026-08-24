// Prove the one-hero protection is actually live in production.
//
// "Success. No rows returned" from a SQL editor is not evidence that a
// constraint is doing anything. This proves the BEHAVIOUR: a second hero insert
// must be refused by the database, a first one must still be accepted, and
// galleries must remain unconstrained.
//
// Creates its own throwaway records and removes them. Touches nothing real.
//
// Usage:
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... node scripts/verify-one-hero-constraint.mjs

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const { error: authErr } = await db.auth.signInWithPassword({
  email: process.env.TC_ADMIN_EMAIL,
  password: process.env.TC_ADMIN_PASSWORD,
});
if (authErr) { console.error("auth:", authErr.message); process.exit(1); }

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  — " + detail : ""));
}

const cleanup = { assets: [], content: [], products: [] };

async function seedAsset(label) {
  const { data, error } = await db
    .from("media_assets")
    .insert({
      media_type: "image",
      storage_path: `image/${crypto.randomUUID()}-constraint-${label}.png`,
      alt_text: `TEMP constraint probe ${label}`,
      publication_status: "private",
      owned: true,
      rights_status: "verified",
      source_type: "staff_photograph",
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed asset: ${error.message}`);
  cleanup.assets.push(data.id);
  return data.id;
}

try {
  const a = await seedAsset("a");
  const b = await seedAsset("b");
  const c = await seedAsset("c");

  const { data: article, error: aErr } = await db
    .from("content_items")
    .insert({ slug: `temp-constraint-${crypto.randomUUID().slice(0, 8)}`, title: "TEMP constraint probe", type: "guide", status: "draft", body: "temp" })
    .select("id")
    .single();
  if (aErr) throw new Error(`seed article: ${aErr.message}`);
  cleanup.content.push(article.id);

  const { data: mfr } = await db.from("manufacturers").select("id").limit(1).single();
  const { data: cat } = await db.from("taxonomy_categories").select("id").limit(1).single();
  const { data: product, error: pErr } = await db
    .from("products")
    .insert({
      slug: `temp-constraint-${crypto.randomUUID().slice(0, 8)}`,
      name: "TEMP constraint probe",
      is_published: false,
      manufacturer_id: mfr?.id,
      category_id: cat?.id,
    })
    .select("id")
    .single();
  if (pErr) throw new Error(`seed product: ${pErr.message}`);
  cleanup.products.push(product.id);

  // --- ARTICLE ---------------------------------------------------------------
  const first = await db.from("content_media").insert({ content_id: article.id, media_id: a, role: "hero", sort_order: 0 });
  check("article accepts a FIRST hero", !first.error, first.error?.message);

  const second = await db.from("content_media").insert({ content_id: article.id, media_id: b, role: "hero", sort_order: 0 });
  check(
    "article REFUSES a second hero (constraint is live)",
    Boolean(second.error) && second.error.code === "23505",
    second.error ? `${second.error.code}: ${second.error.message.slice(0, 90)}` : "INSERT SUCCEEDED — constraint missing"
  );
  check(
    "the refusal names content_media_one_hero_per_content",
    Boolean(second.error?.message?.includes("content_media_one_hero_per_content")),
    second.error?.message?.slice(0, 120)
  );

  // --- PRODUCT ---------------------------------------------------------------
  const pFirst = await db.from("product_media").insert({ product_id: product.id, media_id: a, role: "hero", sort_order: 0 });
  check("product accepts a FIRST hero", !pFirst.error, pFirst.error?.message);

  const pSecond = await db.from("product_media").insert({ product_id: product.id, media_id: b, role: "hero", sort_order: 0 });
  check(
    "product REFUSES a second hero (constraint is live)",
    Boolean(pSecond.error) && pSecond.error.code === "23505",
    pSecond.error ? `${pSecond.error.code}: ${pSecond.error.message.slice(0, 90)}` : "INSERT SUCCEEDED — constraint missing"
  );
  check(
    "the refusal names product_media_one_hero_per_product",
    Boolean(pSecond.error?.message?.includes("product_media_one_hero_per_product")),
    pSecond.error?.message?.slice(0, 120)
  );

  // --- THUMBNAIL: exclusive in exactly the same way -------------------------
  const t1 = await db.from("content_media").insert({ content_id: article.id, media_id: a, role: "thumbnail", sort_order: 0 });
  check("article accepts a FIRST explicit card image", !t1.error, t1.error?.message);

  const t2 = await db.from("content_media").insert({ content_id: article.id, media_id: b, role: "thumbnail", sort_order: 0 });
  check(
    "article REFUSES a second card image (one-thumbnail constraint is live)",
    Boolean(t2.error) && t2.error.code === "23505",
    t2.error ? `${t2.error.code}: ${t2.error.message.slice(0, 90)}` : "INSERT SUCCEEDED - constraint missing"
  );
  check(
    "the refusal names content_media_one_thumbnail_per_content",
    Boolean(t2.error?.message?.includes("content_media_one_thumbnail_per_content")),
    t2.error?.message?.slice(0, 120)
  );

  const pt1 = await db.from("product_media").insert({ product_id: product.id, media_id: a, role: "thumbnail", sort_order: 0 });
  check("product accepts a FIRST explicit card image", !pt1.error, pt1.error?.message);
  const pt2 = await db.from("product_media").insert({ product_id: product.id, media_id: b, role: "thumbnail", sort_order: 0 });
  check(
    "product REFUSES a second card image (one-thumbnail constraint is live)",
    Boolean(pt2.error) && pt2.error.code === "23505",
    pt2.error ? `${pt2.error.code}: ${pt2.error.message.slice(0, 90)}` : "INSERT SUCCEEDED - constraint missing"
  );
  check(
    "the refusal names product_media_one_thumbnail_per_product",
    Boolean(pt2.error?.message?.includes("product_media_one_thumbnail_per_product")),
    pt2.error?.message?.slice(0, 120)
  );

  // --- AND THE SLOT CONSTRAINTS DID NOT BREAK MULTI-SLOT --------------------
  // asset `a` now holds hero AND thumbnail on the same article. Adding gallery
  // must still be accepted: the exclusivity is per SLOT, not per asset/target
  // pairing.
  const g0 = await db.from("content_media").insert({ content_id: article.id, media_id: a, role: "gallery", sort_order: 0 });
  check("ONE asset can still hold hero + thumbnail + gallery on one target", !g0.error, g0.error?.message);
  const { data: aSlots } = await db.from("content_media").select("role").eq("content_id", article.id).eq("media_id", a);
  check("...confirmed: three slots held by a single asset",
    (aSlots ?? []).length === 3,
    (aSlots ?? []).map((r) => r.role).sort().join(", "));

  // --- GALLERIES REMAIN UNCONSTRAINED ---------------------------------------
  const g1 = await db.from("content_media").insert({ content_id: article.id, media_id: b, role: "gallery", sort_order: 1 });
  const g2 = await db.from("content_media").insert({ content_id: article.id, media_id: c, role: "gallery", sort_order: 2 });
  check("galleries still accept MULTIPLE assets", !g1.error && !g2.error, [g1.error?.message, g2.error?.message].filter(Boolean).join("; "));

  // --- A HERO CAN STILL CHANGE HANDS ----------------------------------------
  // `a` already holds a gallery row from the multi-slot check above, so
  // re-labelling its hero row as gallery would duplicate the triple key. That is
  // correct, and it is exactly the case saveAssociations() handles: when the
  // outgoing hero is already in the gallery, the hero ROW is dropped rather than
  // renamed. Mirrored here so the test exercises the real rule.
  const { data: alreadyGallery } = await db
    .from("content_media").select("id").eq("content_id", article.id).eq("media_id", a).eq("role", "gallery").maybeSingle();
  const demote = alreadyGallery
    ? await db.from("content_media").delete().eq("content_id", article.id).eq("media_id", a).eq("role", "hero")
    : await db.from("content_media").update({ role: "gallery" }).eq("content_id", article.id).eq("media_id", a).eq("role", "hero");
  check("the incumbent hero vacates the slot without losing its gallery place", !demote.error, demote.error?.message);
  const promote = await db.from("content_media").insert({ content_id: article.id, media_id: b, role: "hero", sort_order: 0 });
  check("another asset can then take the vacated hero slot", !promote.error, promote.error?.message);

  const { data: finalRows } = await db.from("content_media").select("media_id, role").eq("content_id", article.id);
  const heroes = (finalRows ?? []).filter((r) => r.role === "hero");
  check("exactly one hero after the swap", heroes.length === 1 && heroes[0].media_id === b, `${heroes.length} hero(es)`);
} finally {
  for (const id of cleanup.content) {
    await db.from("content_media").delete().eq("content_id", id);
    await db.from("content_items").delete().eq("id", id);
  }
  for (const id of cleanup.products) {
    await db.from("product_media").delete().eq("product_id", id);
    await db.from("products").delete().eq("id", id);
  }
  for (const id of cleanup.assets) {
    await db.from("content_media").delete().eq("media_id", id);
    await db.from("product_media").delete().eq("media_id", id);
    await db.from("media_assets").delete().eq("id", id);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("FAILED: " + failed.map((f) => f.name).join("; ")); process.exitCode = 1; }
