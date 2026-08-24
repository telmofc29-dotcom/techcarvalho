import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/admin/ui";

// "Used on" — every place this one asset is actually in service.
//
// WHY IT MATTERS
// --------------
// One master is supposed to serve many associations rather than being copied,
// but until now there was no way to SEE those associations from the asset. That
// makes two questions unanswerable from the admin: "is this image already used
// somewhere?" and "if I change this, what moves?" It also hid the defect that
// started this work — an asset holding a hero slot it was not actually
// rendering in, because a second hero existed on the same target.
//
// Reads only. Adds no state of its own.
export async function MediaUsage({ mediaId }: { mediaId: string }) {
  const supabase = await createClient();

  const [{ data: productLinks }, { data: contentLinks }] = await Promise.all([
    supabase.from("product_media").select("product_id, role, sort_order").eq("media_id", mediaId),
    supabase.from("content_media").select("content_id, role, sort_order").eq("media_id", mediaId),
  ]);

  const productIds = [...new Set((productLinks ?? []).map((r) => r.product_id))];
  const contentIds = [...new Set((contentLinks ?? []).map((r) => r.content_id))];

  const [{ data: products }, { data: content }] = await Promise.all([
    productIds.length
      ? supabase.from("products").select("id, name, slug, is_published").in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; name: string; slug: string; is_published: boolean }[] }),
    contentIds.length
      ? supabase.from("content_items").select("id, title, slug, status").in("id", contentIds)
      : Promise.resolve({ data: [] as { id: string; title: string; slug: string; status: string }[] }),
  ]);

  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const contentById = new Map((content ?? []).map((c) => [c.id, c]));

  // Which of these hero slots this asset actually holds ALONE. A hero slot
  // shared with another asset is a contradiction the page should surface rather
  // than quietly present as a working hero.
  const heroProductIds = (productLinks ?? []).filter((r) => r.role === "hero").map((r) => r.product_id);
  const heroContentIds = (contentLinks ?? []).filter((r) => r.role === "hero").map((r) => r.content_id);

  const [{ data: rivalProductHeroes }, { data: rivalContentHeroes }] = await Promise.all([
    heroProductIds.length
      ? supabase.from("product_media").select("product_id, media_id").in("product_id", heroProductIds).eq("role", "hero")
      : Promise.resolve({ data: [] as { product_id: string; media_id: string }[] }),
    heroContentIds.length
      ? supabase.from("content_media").select("content_id, media_id").in("content_id", heroContentIds).eq("role", "hero")
      : Promise.resolve({ data: [] as { content_id: string; media_id: string }[] }),
  ]);

  const contestedProducts = new Set(
    (rivalProductHeroes ?? []).filter((r) => r.media_id !== mediaId).map((r) => r.product_id)
  );
  const contestedContent = new Set(
    (rivalContentHeroes ?? []).filter((r) => r.media_id !== mediaId).map((r) => r.content_id)
  );

  const uses = [
    ...(productLinks ?? []).map((r) => {
      const p = productById.get(r.product_id);
      return {
        key: `p-${r.product_id}-${r.role}`,
        kind: "Product",
        role: r.role,
        label: p?.name ?? r.product_id,
        href: `/admin/products/${r.product_id}`,
        publicHref: p?.is_published ? `/products/${p.slug}` : null,
        contested: r.role === "hero" && contestedProducts.has(r.product_id),
      };
    }),
    ...(contentLinks ?? []).map((r) => {
      const c = contentById.get(r.content_id);
      return {
        key: `c-${r.content_id}-${r.role}`,
        kind: "Article",
        role: r.role,
        label: c?.title ?? r.content_id,
        href: `/admin/content/${r.content_id}`,
        publicHref: c?.status === "published" ? `/articles/${c.slug}` : null,
        contested: r.role === "hero" && contestedContent.has(r.content_id),
      };
    }),
  ].sort((a, b) => (a.role === b.role ? a.label.localeCompare(b.label) : a.role.localeCompare(b.role)));

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-neutral-900 mb-1">Used on</h2>
      <p className="mb-3 text-xs text-neutral-500">
        Every place this master is in service. One asset can legitimately serve many pages — this is the list, not a
        set of copies.
      </p>

      {uses.length === 0 ? (
        <p className="text-sm text-neutral-500">Not used anywhere yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {uses.map((use) => (
            <li key={use.key} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={use.role === "hero" ? "green" : "neutral"}>
                {use.kind} {use.role}
              </Badge>
              <Link href={use.href} className="text-neutral-800 underline">
                {use.label}
              </Link>
              {use.publicHref && (
                <Link href={use.publicHref} className="text-xs text-neutral-500 underline">
                  view live
                </Link>
              )}
              {use.contested && (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                  another asset also holds this hero slot — the page may not show this one
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
