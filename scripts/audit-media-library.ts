// What do the media_assets rows ACTUALLY represent?
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/audit-media-library.ts
//
// READ-ONLY. Nothing is deleted, modified or published.
//
// WHY THIS EXISTS
// ---------------
// Every report on this project has said "112 media assets", and the owner
// looking at /admin/media cannot see 112 images. One of those is wrong, and
// `select count(*)` cannot tell you which — a row count is not an image count.
// Three different things have been collapsed into one number:
//
//   * database ROWS
//   * distinct storage PATHS (two rows can point at one file)
//   * files that actually EXIST in the bucket (a row can point at nothing)
//
// So this checks the third one properly: it asks Storage for each object rather
// than assuming a row implies a file. That is the only check here that can
// discover something the database does not already know.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";

loadEnvLocal();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; storage: any };

type Asset = {
  id: string;
  storage_path: string;
  public_storage_path: string | null;
  media_type: string;
  alt_text: string | null;
  source_type: string | null;
  asset_role: string | null;
  brand_role: string | null;
  publication_status: string;
  rights_status: string;
  owned: boolean;
  ai_generated: boolean;
  created_at: string;
};

const PRIVATE_BUCKET = "media-private";
const PUBLIC_BUCKET = "media-public";
const ADMIN_PAGE_SIZE = 25; // mirrors src/lib/admin/pagination.ts

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;

  // ---- every row, paginated past PostgREST's 1000 default ---------------
  const assets: Asset[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("media_assets").select("*").range(from, from + 999);
    if (error) throw new Error(`reading media_assets failed: ${error.message}`);
    assets.push(...(data as Asset[]));
    if ((data as unknown[]).length < 1000) break;
  }

  // ---- associations ------------------------------------------------------
  const pm = await db.from("product_media").select("media_id,product_id,role");
  if (pm.error) throw new Error(`reading product_media failed: ${pm.error.message}`);
  const cm = await db.from("content_media").select("media_id,content_id,role");
  if (cm.error) throw new Error(`reading content_media failed: ${cm.error.message}`);

  const productLinks = new Map<string, number>();
  for (const r of pm.data as { media_id: string }[]) productLinks.set(r.media_id, (productLinks.get(r.media_id) ?? 0) + 1);
  const contentLinks = new Map<string, number>();
  for (const r of cm.data as { media_id: string }[]) contentLinks.set(r.media_id, (contentLinks.get(r.media_id) ?? 0) + 1);

  // ---- does the file actually exist? -------------------------------------
  //
  // A signed URL is generated for a path whether or not an object is there, so
  // the URL alone proves nothing. The object is FETCHED and the status read.
  async function objectExists(bucket: string, path: string): Promise<boolean | null> {
    const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) return false;
    try {
      const r = await fetch(data.signedUrl, { method: "GET", headers: { Range: "bytes=0-0" } });
      return r.status === 200 || r.status === 206;
    } catch {
      return null; // network failure — unknown, NOT "missing"
    }
  }

  const pathCounts = new Map<string, string[]>();
  for (const a of assets) pathCounts.set(a.storage_path, [...(pathCounts.get(a.storage_path) ?? []), a.id]);

  process.stdout.write(`checking ${pathCounts.size} distinct storage objects`);
  const exists = new Map<string, boolean | null>();
  let n = 0;
  for (const path of pathCounts.keys()) {
    exists.set(path, await objectExists(PRIVATE_BUCKET, path));
    if (++n % 20 === 0) process.stdout.write(".");
  }
  process.stdout.write("\n\n");

  // Published assets should ALSO have a public copy.
  const publicExists = new Map<string, boolean | null>();
  for (const a of assets) {
    if (a.publication_status === "published" && a.public_storage_path) {
      if (!publicExists.has(a.public_storage_path)) {
        publicExists.set(a.public_storage_path, await objectExists(PUBLIC_BUCKET, a.public_storage_path));
      }
    }
  }

  // ---- classification ----------------------------------------------------
  const GENERATED = new Set(["tc_graphic"]);
  const THIRD_PARTY = new Set(["manufacturer", "press_kit", "stock_licensed", "public_domain_or_cc", "user_submitted", "other"]);

  const isGenerated = (a: Asset) => GENERATED.has(a.source_type ?? "");
  const isLogo = (a: Asset) => a.brand_role !== null || a.asset_role === "logo_brand" || a.asset_role === "icon";
  const isScreenshot = (a: Asset) => a.asset_role === "screenshot";
  const isOwned = (a: Asset) => a.source_type === "staff_photograph";
  const isThirdParty = (a: Asset) => THIRD_PARTY.has(a.source_type ?? "");
  const isPhotograph = (a: Asset) =>
    !isGenerated(a) && !isLogo(a) && !isScreenshot(a) &&
    (a.asset_role === null || !["diagram", "chart", "comparison_graphic"].includes(a.asset_role));

  const count = (fn: (a: Asset) => boolean) => assets.filter(fn).length;

  const distinctPaths = pathCounts.size;
  const duplicatePathGroups = [...pathCounts.values()].filter((ids) => ids.length > 1);
  const rowsSharingAPath = duplicatePathGroups.reduce((s, ids) => s + ids.length, 0);
  const missingFiles = assets.filter((a) => exists.get(a.storage_path) === false);
  const unknownFiles = assets.filter((a) => exists.get(a.storage_path) === null);
  const noAssociation = assets.filter((a) => !productLinks.has(a.id) && !contentLinks.has(a.id));
  const bothAssociations = assets.filter((a) => productLinks.has(a.id) && contentLinks.has(a.id));

  const distinctExisting = [...pathCounts.keys()].filter((p) => exists.get(p) === true).length;

  // ---- report ------------------------------------------------------------
  const line = (label: string, value: unknown) =>
    console.log(`  ${String(value).padStart(5)}  ${label}`);

  console.log("=== MEDIA LIBRARY AUDIT (production, read-only) ===\n");

  console.log("HEADLINE");
  console.log(`  ${assets.length} database rows -> ${distinctPaths} distinct storage paths -> ${distinctExisting} files that actually exist`);
  console.log(`  /admin/media shows ${ADMIN_PAGE_SIZE} per page = ${Math.ceil(assets.length / ADMIN_PAGE_SIZE)} pages\n`);

  console.log("RECONCILIATION — every row counted exactly once, by source_type");
  const bySource = new Map<string, number>();
  for (const a of assets) bySource.set(a.source_type ?? "(null)", (bySource.get(a.source_type ?? "(null)") ?? 0) + 1);
  let sourceTotal = 0;
  for (const [k, v] of [...bySource].sort((a, b) => b[1] - a[1])) { line(k, v); sourceTotal += v; }
  line("TOTAL", sourceTotal);
  console.log(`  ${sourceTotal === assets.length ? "accounts for every row" : "MISMATCH"}\n`);

  console.log("BY EDITORIAL ROLE (asset_role) — every row counted once");
  const byRole = new Map<string, number>();
  for (const a of assets) byRole.set(a.asset_role ?? "(null)", (byRole.get(a.asset_role ?? "(null)") ?? 0) + 1);
  let roleTotal = 0;
  for (const [k, v] of [...byRole].sort((a, b) => b[1] - a[1])) { line(k, v); roleTotal += v; }
  line("TOTAL", roleTotal);
  console.log("");

  console.log("WHAT KIND OF IMAGE (overlapping categories, so these do NOT sum)");
  line("generated graphics (tc_graphic)", count(isGenerated));
  line("logos / brand marks", count(isLogo));
  line("screenshots", count(isScreenshot));
  line("owned photographs (staff_photograph)", count(isOwned));
  line("third-party imagery", count(isThirdParty));
  line("plausibly photographs", count(isPhotograph));
  console.log("");

  console.log("PUBLICATION AND STORAGE");
  line("published", count((a) => a.publication_status === "published"));
  line("private / unpublished", count((a) => a.publication_status !== "published"));
  line("published WITH a public copy recorded", count((a) => a.publication_status === "published" && !!a.public_storage_path));
  line("published but public object MISSING", assets.filter((a) => a.publication_status === "published" && a.public_storage_path && publicExists.get(a.public_storage_path) === false).length);
  console.log("");

  console.log("FILE INTEGRITY");
  line("distinct storage paths", distinctPaths);
  line("paths whose object EXISTS", distinctExisting);
  line("paths whose object is MISSING", [...pathCounts.keys()].filter((p) => exists.get(p) === false).length);
  line("paths unknown (fetch failed)", [...pathCounts.keys()].filter((p) => exists.get(p) === null).length);
  line("rows pointing at a missing file", missingFiles.length);
  line("rows pointing at an unknown file", unknownFiles.length);
  console.log("");

  console.log("DUPLICATION");
  line("distinct paths shared by >1 row", duplicatePathGroups.length);
  line("rows involved in those groups", rowsSharingAPath);
  line("rows that are the ONLY user of their path", assets.length - rowsSharingAPath);
  if (duplicatePathGroups.length) {
    console.log("  examples:");
    for (const [path, ids] of [...pathCounts].filter(([, ids]) => ids.length > 1).slice(0, 5)) {
      console.log(`    ${ids.length}x  ${path}`);
    }
  }
  console.log("");

  console.log("ASSOCIATION");
  line("linked to >=1 product", assets.filter((a) => productLinks.has(a.id)).length);
  line("linked to >=1 article", assets.filter((a) => contentLinks.has(a.id)).length);
  line("linked to BOTH", bothAssociations.length);
  line("linked to NOTHING", noAssociation.length);
  console.log("");

  console.log("VISIBILITY IN /admin/media");
  console.log(`  The page has NO status/rights/type filter by default and NO RLS restriction`);
  console.log(`  beyond requireAdmin(), so all ${assets.length} rows are reachable — across`);
  console.log(`  ${Math.ceil(assets.length / ADMIN_PAGE_SIZE)} pages of ${ADMIN_PAGE_SIZE}.`);
  console.log(`  Rows whose PREVIEW would fail to load (missing object): ${missingFiles.length}`);
  console.log(`  Those rows still render as cards; the image inside them is broken.`);
  console.log("");

  console.log("HONEST HEADLINE NUMBERS FOR FUTURE REPORTS");
  line("media records", assets.length);
  line("unique media files (existing objects)", distinctExisting);
  line("unique photographs (best estimate)", new Set(assets.filter(isPhotograph).map((a) => a.storage_path)).size);
  line("unique generated graphics", new Set(assets.filter(isGenerated).map((a) => a.storage_path)).size);
  line("unique logos/brand marks", new Set(assets.filter(isLogo).map((a) => a.storage_path)).size);
  line("visible in /admin/media (page 1)", Math.min(ADMIN_PAGE_SIZE, assets.length));
}

main().catch((e) => { console.error("audit failed:", e instanceof Error ? e.message : e); process.exitCode = 1; });
