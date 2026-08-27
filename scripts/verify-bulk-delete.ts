// BULK DELETE, AGAINST THE REAL SCHEMA.
//
// WHAT UNIT TESTS CANNOT COVER
// ----------------------------
// assessDeletion() is pure and has 13 tests. What they cannot tell you is
// whether the SEVEN relationship queries that feed it actually work against
// production: a renamed column, a table RLS hides from this role, or a
// reference nobody remembered would all produce the same thing — an empty
// result that looks exactly like "nothing points at this asset" and licenses a
// permanent delete.
//
// So this runs the real queries against real rows. It seeds DISPOSABLE records,
// attaches them the way a real page would, and checks that the assessment
// refuses the attached ones and clears the unattached one. Then it removes
// everything it made and verifies the removal.
//
// IT NEVER TOUCHES A PRE-EXISTING ROW. Every record it creates carries a unique
// tag, every delete is filtered on that tag, and the pre-existing counts are
// re-read at the end and compared.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-bulk-delete.ts
//
// The Server Action itself needs a request context and cannot be called here;
// what is proven is that the queries behind it return the truth about real
// rows, and that the decision on that truth is the safe one.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { assessDeletion, type DeletionReferences } from "../src/lib/media/deletion-safety.ts";

loadEnvLocal();

type Check = { name: string; state: "PASS" | "FAIL"; detail: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string) =>
  checks.push({ name, state: ok ? "PASS" : "FAIL", detail });

const TAG = `bulkdel-${Date.now().toString(36)}`;

async function main(): Promise<void> {
  const db = await createAdminClient();

  const before = {
    media: (await db.from("media_assets").select("id", { count: "exact", head: true })).count,
    content: (await db.from("content_items").select("id", { count: "exact", head: true })).count,
    links: (await db.from("content_media").select("id", { count: "exact", head: true })).count,
  };

  const madeMedia: string[] = [];
  const madeContent: string[] = [];

  // ---- seed disposable records -----------------------------------------
  const newAsset = async (label: string): Promise<string | null> => {
    const { data, error } = await db
      .from("media_assets")
      .insert({
        storage_path: `${TAG}/${label}.jpg`,
        media_type: "image",
        alt_text: `${TAG} ${label}`,
        publication_status: "private",
        rights_status: "unknown",
      })
      .select("id")
      .single();
    if (error || !data) {
      record(`seed media ${label}`, false, error?.message ?? "no row");
      return null;
    }
    madeMedia.push(data.id);
    return data.id;
  };

  const attachedId = await newAsset("attached");
  const orphanId = await newAsset("orphan");
  const ogId = await newAsset("og-referenced");
  if (!attachedId || !orphanId || !ogId) return finish(db, madeMedia, madeContent, before);

  const { data: article, error: articleError } = await db
    .from("content_items")
    .insert({
      type: "news",
      title: `${TAG} disposable article`,
      slug: `${TAG}-article`,
      body: "disposable",
      status: "draft",
    })
    .select("id")
    .single();
  if (articleError || !article) {
    record("seed article", false, articleError?.message ?? "no row");
    return finish(db, madeMedia, madeContent, before);
  }
  madeContent.push(article.id);

  // The social-card reference lives on seo_metadata, which is the whole point
  // of this case: it is a SET NULL reference on a table nobody thinks about
  // when deleting an image.
  const { error: seoError } = await db
    .from("seo_metadata")
    .insert({ content_id: article.id, og_media_id: ogId } as never);
  record("seeded a social-card reference on seo_metadata", !seoError, seoError?.message ?? "seo_metadata row created");

  const { error: linkError } = await db
    .from("content_media")
    .insert({ content_id: article.id, media_id: attachedId, role: "hero", sort_order: 0 } as never);
  record("seeded a hero attachment", !linkError, linkError?.message ?? "content_media hero row created");

  // ---- the real relationship queries -----------------------------------
  const ids = [attachedId, orphanId, ogId];
  const [assets, contentLinks, productLinks, derivatives, ogRefs, logoRefs, requirementRefs, candidateRefs] =
    await Promise.all([
      db.from("media_assets").select("id, storage_path, publication_status").in("id", ids),
      db.from("content_media").select("media_id, role").in("media_id", ids),
      db.from("product_media").select("media_id, role").in("media_id", ids),
      db.from("media_derivatives").select("media_asset_id").in("media_asset_id", ids),
      db.from("seo_metadata").select("og_media_id").in("og_media_id", ids),
      db.from("manufacturers").select("logo_media_id").in("logo_media_id", ids),
      db.from("media_requirements").select("resolved_media_id").in("resolved_media_id", ids),
      db.from("engine_media_candidates").select("ingested_media_id").in("ingested_media_id", ids),
    ]);

  // EVERY ONE OF THESE MUST BE REACHABLE. A query that errors and a query that
  // returns nothing are indistinguishable downstream unless this is checked,
  // and here the difference is whether a permanent delete goes ahead.
  const named = [
    ["media_assets", assets],
    ["content_media", contentLinks],
    ["product_media", productLinks],
    ["media_derivatives", derivatives],
    ["seo_metadata.og_media_id", ogRefs],
    ["manufacturers.logo_media_id", logoRefs],
    ["media_requirements", requirementRefs],
    ["engine_media_candidates", candidateRefs],
  ] as const;
  const readFailures = named.filter(([, r]) => r.error).map(([n, r]) => `${n}: ${r.error!.message}`);
  record(
    "all seven relationship queries are reachable as this admin",
    readFailures.length === 0,
    readFailures.length === 0 ? named.map(([n]) => n).join(", ") : readFailures.join("; ")
  );

  const countFor = (rows: unknown, key: string, id: string): number =>
    ((rows ?? []) as Record<string, unknown>[]).filter((r) => String(r[key] ?? "") === id).length;
  const rolesFor = (rows: unknown, id: string): string[] =>
    ((rows ?? []) as Record<string, unknown>[])
      .filter((r) => String(r.media_id ?? "") === id)
      .map((r) => String(r.role ?? ""));

  const refsFor = (id: string): DeletionReferences => {
    const row = ((assets.data ?? []) as { id: string; storage_path: string; publication_status: string }[]).find(
      (a) => a.id === id
    );
    return {
      contentRoles: rolesFor(contentLinks.data, id),
      productRoles: rolesFor(productLinks.data, id),
      ogReferences: countFor(ogRefs.data, "og_media_id", id),
      logoReferences: countFor(logoRefs.data, "logo_media_id", id),
      requirementReferences: countFor(requirementRefs.data, "resolved_media_id", id),
      derivatives: countFor(derivatives.data, "media_asset_id", id),
      engineCandidates: countFor(candidateRefs.data, "ingested_media_id", id),
      publicationStatus: row?.publication_status ?? "unknown",
      exists: row !== undefined,
      readFailures,
    };
  };

  // ---- the three cases --------------------------------------------------
  const attached = assessDeletion(attachedId, "attached.jpg", refsFor(attachedId));
  record(
    "an asset holding an article hero is REFUSED",
    attached.blocked && /article slot/.test(attached.reason ?? ""),
    attached.reason ?? "NOT BLOCKED — a live hero would have been deleted"
  );

  const og = assessDeletion(ogId, "og-referenced.jpg", refsFor(ogId));
  record(
    "an asset that is only a SET NULL reference is still REFUSED",
    og.blocked && /social-card/.test(og.reason ?? ""),
    og.reason ?? "NOT BLOCKED — the article's social card would have blanked silently"
  );

  const orphan = assessDeletion(orphanId, "orphan.jpg", refsFor(orphanId));
  record(
    "an unattached asset is ALLOWED, so the protection is not refusing everything",
    !orphan.blocked,
    orphan.reason ?? "no blocking relationship found"
  );

  // ---- a missing row is refused, not silently reported as deleted -------
  const ghost = assessDeletion("00000000-0000-0000-0000-000000000000", "ghost.jpg", {
    ...refsFor(orphanId),
    exists: false,
  });
  record("a non-existent id is REFUSED", ghost.blocked, ghost.reason ?? "NOT BLOCKED");

  // ---- and once detached, the same asset becomes deletable --------------
  await db.from("content_media").delete().eq("content_id", article.id).eq("media_id", attachedId);
  const { data: afterDetach, error: afterError } = await db
    .from("content_media")
    .select("media_id, role")
    .in("media_id", ids);
  const detached = assessDeletion(attachedId, "attached.jpg", {
    ...refsFor(attachedId),
    contentRoles: afterError ? [] : rolesFor(afterDetach, attachedId),
    readFailures: afterError ? [afterError.message] : [],
  });
  record(
    "detaching it makes it deletable — the refusal was about the attachment, not the asset",
    !detached.blocked,
    detached.reason ?? "now unattached"
  );

  await finish(db, madeMedia, madeContent, before);
}

async function finish(
  db: Awaited<ReturnType<typeof createAdminClient>>,
  media: string[],
  content: string[],
  before: { media: number | null; content: number | null; links: number | null }
): Promise<void> {
  for (const id of content) await db.from("content_items").delete().eq("id", id);
  for (const id of media) await db.from("media_assets").delete().eq("id", id);

  const after = {
    media: (await db.from("media_assets").select("id", { count: "exact", head: true })).count,
    content: (await db.from("content_items").select("id", { count: "exact", head: true })).count,
    links: (await db.from("content_media").select("id", { count: "exact", head: true })).count,
  };
  const restored =
    after.media === before.media && after.content === before.content && after.links === before.links;
  record(
    "every seeded record removed; pre-existing rows untouched",
    restored,
    `media ${before.media}->${after.media}  content ${before.content}->${after.content}  links ${before.links}->${after.links}`
  );

  console.log("\n=== BULK DELETE — REAL SCHEMA, DISPOSABLE ROWS ===\n");
  for (const c of checks) {
    console.log(`  ${c.state.padEnd(5)} ${c.name}`);
    console.log(`        ${c.detail}`);
  }
  const failed = checks.filter((c) => c.state === "FAIL");
  console.log(`\n  ${checks.length - failed.length}/${checks.length} PASS`);
  console.log(`  BULK DELETE SAFETY: ${failed.length === 0 ? "PASS" : "FAIL"}\n`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
