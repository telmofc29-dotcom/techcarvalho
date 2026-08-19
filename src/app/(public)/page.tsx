import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo/site";
import { PLANNED_CATEGORIES } from "@/lib/public/categories";
import { getLatestPublishedContent } from "@/lib/public/queries";
import { Badge, EmptyState } from "@/components/shared/ui";

export default async function HomePage() {
  const supabase = await createClient();
  const [{ data: categories }, latestContent] = await Promise.all([
    supabase.from("taxonomy_categories").select("id, slug").is("parent_id", null),
    getLatestPublishedContent(6),
  ]);

  let liveSlugSet = new Set<string>();
  if (categories && categories.length > 0) {
    const { data: publishedCounts } = await supabase
      .from("products")
      .select("category_id")
      .eq("is_published", true)
      .in(
        "category_id",
        categories.map((c) => c.id)
      );
    const categoryIdToSlug = new Map(categories.map((c) => [c.id, c.slug]));
    liveSlugSet = new Set((publishedCounts ?? []).map((p) => categoryIdToSlug.get(p.category_id)).filter((s): s is string => Boolean(s)));
  }

  return (
    <div className="mx-auto max-w-6xl px-6">
      <section className="py-20 border-b border-neutral-200">
        <h1 className="text-4xl font-semibold tracking-tight text-neutral-900 max-w-2xl">{SITE_NAME}</h1>
        <p className="text-xl text-neutral-500 mt-3 max-w-xl">{SITE_TAGLINE}</p>
      </section>

      <section className="py-14 border-b border-neutral-200">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-6">Subject areas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PLANNED_CATEGORIES.map((category) => {
            const isLive = liveSlugSet.has(category.slug);
            return (
              <Link
                key={category.slug}
                href={`/${category.slug}`}
                id={`home-category-${category.slug}`}
                className="rounded-lg border border-neutral-200 p-5 hover:border-neutral-400 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-neutral-900">{category.label}</h3>
                  {!isLive && <Badge>Coming soon</Badge>}
                </div>
                <p className="text-sm text-neutral-500">{category.blurb}</p>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="py-14">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-6">Latest</h2>
        {latestContent.length === 0 ? (
          <EmptyState
            title="Nothing published yet"
            description="Reviews, guides, comparisons, and news will appear here as they're published — nothing is shown until it's real."
          />
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {latestContent.map((item) => (
              <li key={item.id} className="rounded-lg border border-neutral-200 p-5">
                <Badge>{item.type}</Badge>
                <h3 className="font-medium text-neutral-900 mt-2">
                  <Link href={`/articles/${item.slug}`}>{item.title}</Link>
                </h3>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
