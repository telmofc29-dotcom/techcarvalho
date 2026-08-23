// The shooting list, ranked by how much of the site each photograph fixes.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/photo-requests.ts
//
// READ-ONLY. Every read checks its own error and throws — a query with a wrong
// column name that returns [] produces a fabricated measurement, which has
// already happened twice in this project.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { rankPhotoRequests, type PhotoRequestInput, type CurrentMediaState } from "../src/lib/media/photo-requests.ts";
import { ACCESS_LABEL, type OwnerAccess } from "../src/lib/media/resolution.ts";

loadEnvLocal();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

async function read<T>(db: Db, table: string, columns: string): Promise<T[]> {
  const { data, error } = await db.from(table).select(columns);
  if (error) throw new Error(`reading ${table} (${columns}) failed: ${error.message}`);
  if (data === null) throw new Error(`reading ${table} returned null rather than rows`);
  return data as T[];
}

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;

  // owner_access arrives with supabase/migrations_pending/20260825_product_owner_access.sql.
  // Until that is applied the column does not exist and PostgREST rejects the
  // select outright (42703), so this falls back to the narrower query — and SAYS
  // SO. It does not swallow the error: an unreported fallback is how a run
  // reports "nothing is obtainable" when the truth is "the column is missing".
  type ProductRow = {
    id: string; name: string; slug: string; is_published: boolean;
    owner_access?: string | null;
  };
  let products: ProductRow[];
  let accessKnown = true;
  {
    const withAccess = await db.from("products").select("id,name,slug,is_published,owner_access");
    if (withAccess.error) {
      if (!/owner_access/.test(withAccess.error.message)) {
        throw new Error(`reading products failed: ${withAccess.error.message}`);
      }
      accessKnown = false;
      console.log(
        "NOTE: products.owner_access does not exist yet — 20260825_product_owner_access.sql\n" +
        "      is not applied. Every product is treated as access UNKNOWN, which means\n" +
        "      'nobody has assessed it', so nothing is filtered out. Access-based ranking\n" +
        "      is inactive until the migration runs.\n"
      );
      products = await read<ProductRow>(db, "products", "id,name,slug,is_published");
    } else {
      if (withAccess.data === null) throw new Error("reading products returned null rather than rows");
      products = withAccess.data as ProductRow[];
    }
  }
  const contentProducts = await read<{ content_id: string; product_id: string }>(
    db, "content_products", "content_id,product_id"
  );
  const content = await read<{ id: string; title: string; status: string }>(
    db, "content_items", "id,title,status"
  );
  const productMedia = await read<{ product_id: string; media_id: string; role: string }>(
    db, "product_media", "product_id,media_id,role"
  );
  const media = await read<{ id: string; source_type: string | null; asset_role: string | null }>(
    db, "media_assets", "id,source_type,asset_role"
  );

  const mediaById = new Map(media.map((m) => [m.id, m]));
  const publishedContent = new Map(
    content.filter((c) => c.status === "published").map((c) => [c.id, c.title])
  );

  const articlesByProduct = new Map<string, string[]>();
  for (const cp of contentProducts) {
    const title = publishedContent.get(cp.content_id);
    if (!title) continue;
    articlesByProduct.set(cp.product_id, [...(articlesByProduct.get(cp.product_id) ?? []), title]);
  }

  const inputs: PhotoRequestInput[] = products.map((p) => {
    const heroes = productMedia.filter((pm) => pm.product_id === p.id && pm.role === "hero");
    const assets = heroes.map((h) => mediaById.get(h.media_id)).filter(Boolean);
    const anyReal = assets.some(
      (a) => a && a.source_type !== "tc_graphic" && a.source_type !== null
    );
    const owned = assets.some((a) => a && a.source_type === "staff_photograph");

    let currentMedia: CurrentMediaState = "none";
    if (owned) currentMedia = "owned_original";
    else if (assets.some((a) => a && (a.asset_role === "diagram" || a.asset_role === "chart" || a.asset_role === "comparison_graphic")))
      currentMedia = "data_graphic";
    else if (anyReal) currentMedia = "licensed_third_party";
    else if (assets.length > 0) currentMedia = "generic_graphic";

    return {
      productId: p.id,
      productName: p.name,
      productSlug: p.slug,
      articleTitles: articlesByProduct.get(p.id) ?? [],
      productPublished: p.is_published,
      currentMedia,
      hasRealPhotograph: anyReal,
      ownerAccess: (p.owner_access as OwnerAccess | undefined) ?? "unknown",
    };
  });

  const requests = rankPhotoRequests(inputs);

  console.log(`=== PHOTOGRAPHY REQUESTS — ${requests.length} of ${products.length} products ===\n`);
  const byPriority = (p: string) => requests.filter((r) => r.priority === p);
  console.log(`high ${byPriority("high").length}   medium ${byPriority("medium").length}   low ${byPriority("low").length}`);
  const blocked = requests.filter((r) => !r.shootable).length;
  console.log(
    `shootable ${requests.length - blocked}   not obtainable ${blocked}` +
      (accessKnown ? "" : "   (access not yet assessed for any product)") + "\n"
  );

  for (const r of requests.slice(0, 15)) {
    console.log(`PHOTO REQUEST — ${r.productName}`);
    console.log(`  priority : ${r.priority.toUpperCase()}   pages improved: ${r.pagesAffected}   access: ${ACCESS_LABEL[r.ownerAccess]}`);
    console.log(`  reason   : ${r.reason}`);
    if (r.articleTitles.length > 0) {
      console.log(`  waiting  : ${r.articleTitles.slice(0, 3).map((t) => t.slice(0, 54)).join(" | ")}`);
    }
    console.log(`  shots    : ${r.shotList.length} (${r.shotList[0].split(" —")[0]}, …)`);
    console.log("");
  }
  if (requests.length > 15) console.log(`… and ${requests.length - 15} more.`);
}

main().catch((e) => {
  console.error("photo-requests failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
