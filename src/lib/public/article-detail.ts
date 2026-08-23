import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getResolvedArticleHero, attachHeroImages, type HeroImage } from "./hero-image";
import { attachExcerpts } from "./excerpt";
import {
  classifyClusterEdges,
  rankComparisonSiblings,
  subjectTags,
  MIN_CLUSTER_MEMBERS,
  type RelationshipEdge,
} from "./content-cluster";
import { logQueryError } from "@/lib/log/query-error";
import { ROOT_LOCALE, type Locale } from "@/lib/i18n/locales";
import type { ContentRelationshipType } from "@/lib/types/database";

export type ArticleRef = {
  id: string;
  title: string;
  slug: string;
  type: string;
  published_at: string | null;
  excerpt: string | null;
  heroImage: HeroImage | null;
};

// Where this piece sits in the site's hub structure. Every entry is a real,
// existing route that renders real published content — see `hubs` below.
export type ArticleHubLink = {
  label: string;
  path: string;
  // What kind of hub this is, so the page can group them without re-deriving
  // it from the path.
  kind: "family" | "manufacturer" | "category";
};

export type ArticleDetail = {
  content: {
    id: string;
    title: string;
    slug: string;
    type: string;
    body: string | null;
    published_at: string | null;
    updated_at: string;
    /** Bumped by trigger ONLY on title/body change. 1 = never edited. */
    translatable_revision: number | null;
    translation_group_id: string | null;
    category_id: string | null;
  };
  // The article's taxonomy category, when it has one. Used for the visible
  // breadcrumb trail (Home > Category > Articles > piece) and for the
  // Article schema's articleSection — both were previously unavailable
  // because the query didn't select category_id at all.
  category: { name: string; slug: string } | null;
  products: { id: string; name: string; slug: string; role: string }[];
  tags: { name: string; slug: string }[];
  freshness: { reviewed_at: string; reason: string }[];
  /**
   * The article's cited sources, for the reader.
   *
   * These were fetched by NOTHING before. The page instead rendered a fixed
   * prose box saying "Evidence, sourcing, and testing records behind this piece
   * are tracked internally" — on every article, with no check. It was untrue on
   * 23 of the 81 published pieces, which have no source records at all, and
   * "testing records" implied hands-on testing that has never happened
   * anywhere on this site. A claim about evidence, made without consulting the
   * evidence, is the exact failure this project spent a whole phase removing
   * from the engine; it was sitting in the reader-facing chrome the whole time.
   *
   * Showing the actual rows means the page can only ever claim what is there,
   * and an article with no sources now shows nothing rather than a reassurance.
   */
  sources: { url: string; publisher: string | null; reliability_tier: string; retrieved_at: string }[];
  seo: { meta_title: string | null; meta_description: string | null; canonical_url: string | null; noindex: boolean } | null;
  related: { id: string; title: string; slug: string; type: string; published_at: string | null; heroImage: HeroImage | null }[];
  heroImage: HeroImage | null;
  // --- Cluster structure (new) -------------------------------------------
  // Pieces that support THIS one: this article is the pillar of a series and
  // these are its members. Uncapped — the whole point of a pillar page is that
  // it links to its entire cluster.
  clusterMembers: ArticleRef[];
  // Pillar(s) this piece supports, i.e. the hub it should link UP to with the
  // pillar's own title as the anchor text. This is the consolidation half of
  // the cannibalisation fix: a supporting piece that competes with its pillar
  // stops competing once it visibly defers to it.
  clusterPillars: ArticleRef[];
  // Sibling "X vs Y" pieces, for comparison articles only.
  comparisonSiblings: { article: ArticleRef; sharedTags: string[] }[];
  // Hubs this piece rolls up to.
  hubs: ArticleHubLink[];
};

// A comparison page's sibling rail. Four is the point at which the rail still
// reads as a curated set rather than a dump of everything sharing a tag.
const MAX_COMPARISON_SIBLINGS = 4;

// Cached per-request — see product-detail.ts for why.
export const getArticleDetail = cache(
  async (slug: string, locale: Locale = ROOT_LOCALE): Promise<ArticleDetail | null> => {
  const supabase = await createClient();

  // The locale filter is NOT optional politeness — it is load-bearing.
  //
  // 20260824_translation_model.sql dropped the global unique constraint on
  // `slug` and replaced it with a unique index on (locale, slug), precisely so
  // that "the Portuguese version of an article may legitimately keep the same
  // slug". Without this filter, the first time a translation is published under
  // its source's slug this query matches two rows, .maybeSingle() fails with
  // PGRST116, `content` comes back null — and the ENGLISH article 404s.
  //
  // Nothing would have surfaced that until it happened in production, because
  // there are currently zero translations and the query looks correct.
  const { data: content, error: contentError } = await supabase
    .from("content_items")
    .select("id, title, slug, type, body, published_at, updated_at, status, category_id, translatable_revision, translation_group_id")
    .eq("slug", slug)
    .eq("locale", locale)
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .maybeSingle();
  logQueryError(`getArticleDetail(${locale}:${slug}) content`, contentError);

  if (!content) return null;

  const isComparison = content.type === "comparison";

  const [
    { data: productLinks, error: productLinksError },
    { data: tagRows, error: tagRowsError },
    { data: freshnessRows, error: freshnessError },
    { data: sourceRows, error: sourcesError },
    { data: seo, error: seoError },
    { data: sameTypeContent, error: sameTypeError },
    heroImage,
    { data: outgoingRelationships, error: outgoingRelationshipsError },
    { data: incomingRelationships, error: incomingRelationshipsError },
    { data: category, error: categoryError },
    // Three tiny, world-readable reference tables (59 / 15 / 7 rows against
    // production), fetched whole and matched in JS. Pulling them here rather
    // than as targeted `.in(...)` lookups keeps the round-trip DEPTH flat:
    // the tag slugs are needed to resolve brand hubs and to score comparison
    // siblings, and fetching them by id would have forced two more sequential
    // rounds on the hottest page type on the site.
    { data: allTags, error: allTagsError },
    { data: allManufacturers, error: allManufacturersError },
    { data: allFamilies, error: allFamiliesError },
    // Candidate siblings for a comparison piece. `content.type` is known
    // before this batch runs, so this costs nothing on the ~75% of articles
    // that are not comparisons.
    { data: comparisonCandidates, error: comparisonCandidatesError },
  ] = await Promise.all([
    supabase.from("content_products").select("product_id, role").eq("content_id", content.id),
    supabase.from("content_tags").select("tag_id").eq("content_id", content.id),
    supabase
      .from("freshness_log")
      .select("reviewed_at, reason")
      .eq("content_id", content.id)
      .order("reviewed_at", { ascending: false })
      .limit(5),
    // Publicly readable for a published parent (see the RLS policy "public can
    // read sources of published parents"), so this needs no new grant.
    supabase
      .from("source_records")
      .select("url, publisher, reliability_tier, retrieved_at")
      .eq("content_id", content.id)
      .order("reliability_tier", { ascending: true })
      .order("retrieved_at", { ascending: false }),
    supabase
      .from("seo_metadata")
      .select("meta_title, meta_description, canonical_url, noindex")
      .eq("content_id", content.id)
      .maybeSingle(),
    // Fallback only — see the shared-product query and the explicit
    // content_relationships query below, both preferred when they have
    // enough results, since they reflect a genuine editorial relationship
    // rather than just "published around the same time."
    supabase
      .from("content_items")
      .select("id, title, slug, type, published_at")
      .eq("type", content.type)
      .eq("status", "published")
      .neq("id", content.id)
      .lte("published_at", new Date().toISOString())
      .order("published_at", { ascending: false })
      .limit(3),
    // Not a lookup of `content_media` role='hero' any more — a SELECTION over
    // everything the site holds for this piece, including the photography of
    // the products it links to. See resolveArticleHeroes() in ./hero-image.ts
    // and src/lib/media/hero-selection.ts for what it will and will not swap:
    // a comparison chart on a comparison page, and a diagram on an explainer,
    // are kept deliberately.
    getResolvedArticleHero({ id: content.id, title: content.title, type: content.type }),
    // Explicit editorial clustering (pillar_of/supporting_of/related_to),
    // curated via the admin content edit page — same directional-row +
    // reverse-inferred-at-query-time pattern as product_relationships (see
    // product-detail.ts). This is the highest-signal relationship source;
    // until this fix it was recorded but never actually surfaced to
    // visitors (see 20260820_content_relationships.sql's own header).
    //
    // `relationship_type` is now selected on both directions. It was
    // previously discarded, which flattened pillar_of / supporting_of /
    // related_to into one undifferentiated "related" bucket — the site
    // recorded which piece was the hub of a cluster and then rendered every
    // cluster as a flat list of three.
    supabase.from("content_relationships").select("related_content_id, relationship_type").eq("content_id", content.id),
    supabase.from("content_relationships").select("content_id, relationship_type").eq("related_content_id", content.id),
    content.category_id
      ? supabase.from("taxonomy_categories").select("name, slug").eq("id", content.category_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("taxonomy_tags").select("id, name, slug"),
    supabase.from("manufacturers").select("id, name, slug"),
    supabase.from("product_families").select("id, name, slug"),
    isComparison
      ? supabase
          .from("content_items")
          .select("id, title, slug, type, published_at, category_id")
          .eq("type", "comparison")
          .eq("status", "published")
          .neq("id", content.id)
          .lte("published_at", new Date().toISOString())
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const [ctx, err] of [
    ["productLinks", productLinksError],
    ["tagRows", tagRowsError],
    ["freshness", freshnessError],
    ["sources", sourcesError],
    ["seo", seoError],
    ["sameType", sameTypeError],
    ["outgoingRelationships", outgoingRelationshipsError],
    ["incomingRelationships", incomingRelationshipsError],
    ["category", categoryError],
    ["allTags", allTagsError],
    ["allManufacturers", allManufacturersError],
    ["allFamilies", allFamiliesError],
    ["comparisonCandidates", comparisonCandidatesError],
  ] as const) {
    logQueryError(`getArticleDetail(${slug}) ${ctx}`, err);
  }

  const tagById = new Map((allTags ?? []).map((t) => [t.id, t]));
  const tags = (tagRows ?? [])
    .map((t) => tagById.get(t.tag_id))
    .filter((t): t is { id: string; name: string; slug: string } => Boolean(t))
    .map((t) => ({ name: t.name, slug: t.slug }));
  const tagSlugs = tags.map((t) => t.slug);

  const productIds = (productLinks ?? []).map((p) => p.product_id);
  const roleByProductId = new Map((productLinks ?? []).map((p) => [p.product_id, p.role]));

  // Normalise both stored directions into one edge list, then classify. See
  // content-cluster.ts: production stores 33 pairs in BOTH directions
  // (a pillar_of row plus its mirrored supporting_of row), and without this
  // normalisation those pieces would render twice on the same page.
  const edges: RelationshipEdge[] = [
    ...(outgoingRelationships ?? []).map((r) => ({
      otherId: r.related_content_id,
      type: r.relationship_type as ContentRelationshipType,
      direction: "outgoing" as const,
    })),
    ...(incomingRelationships ?? []).map((r) => ({
      otherId: r.content_id,
      type: r.relationship_type as ContentRelationshipType,
      direction: "incoming" as const,
    })),
  ];
  const roles = classifyClusterEdges(edges);
  const relationshipIds = [...new Set([...roles.supportedByIds, ...roles.pillarIds, ...roles.relatedIds])];

  const comparisonCandidateIds = (comparisonCandidates ?? []).map((c) => c.id);

  // Content genuinely related via a shared product mention (content_products)
  // — needs productIds from round 1, so this can't be batched into it.
  const [
    { data: sharedProductLinks, error: sharedProductLinksError },
    { data: candidateTagLinks, error: candidateTagLinksError },
  ] = await Promise.all([
    productIds.length > 0
      ? supabase.from("content_products").select("content_id").in("product_id", productIds).neq("content_id", content.id)
      : Promise.resolve({ data: [], error: null }),
    comparisonCandidateIds.length > 0
      ? supabase.from("content_tags").select("content_id, tag_id").in("content_id", comparisonCandidateIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  logQueryError(`getArticleDetail(${slug}) sharedProductLinks`, sharedProductLinksError);
  logQueryError(`getArticleDetail(${slug}) candidateTagLinks`, candidateTagLinksError);
  const relatedByProductIds = [...new Set((sharedProductLinks ?? []).map((c) => c.content_id))];

  const [
    { data: productRows, error: productRowsError },
    { data: relatedByProduct, error: relatedByProductError },
    { data: relatedByRelationship, error: relatedByRelationshipError },
  ] = await Promise.all([
    productIds.length > 0
      ? supabase.from("products").select("id, name, slug, family_id").in("id", productIds).eq("is_published", true)
      : Promise.resolve({ data: [], error: null }),
    relatedByProductIds.length > 0
      ? supabase
          .from("content_items")
          .select("id, title, slug, type, published_at")
          .in("id", relatedByProductIds)
          .eq("status", "published")
          .lte("published_at", new Date().toISOString())
          .order("published_at", { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [], error: null }),
    relationshipIds.length > 0
      ? supabase
          .from("content_items")
          .select("id, title, slug, type, published_at")
          .in("id", relationshipIds)
          .eq("status", "published")
          .lte("published_at", new Date().toISOString())
          .order("published_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  logQueryError(`getArticleDetail(${slug}) productRows`, productRowsError);
  logQueryError(`getArticleDetail(${slug}) relatedByProduct`, relatedByProductError);
  logQueryError(`getArticleDetail(${slug}) relatedByRelationship`, relatedByRelationshipError);

  const products = (productRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    role: roleByProductId.get(p.id) ?? "mentioned",
  }));

  // --- Cluster assembly ---------------------------------------------------
  // Only published pieces survive the query above, so a cluster never links a
  // draft. `relatedByRelationship` is the resolved set for every relationship
  // bucket at once; split it back out by role.
  const relationshipRows = relatedByRelationship ?? [];
  const supportedBySet = new Set(roles.supportedByIds);
  const pillarSet = new Set(roles.pillarIds);

  const [clusterMemberRefs, clusterPillarRefs] = await Promise.all([
    toArticleRefs(supabase, relationshipRows.filter((r) => supportedBySet.has(r.id))),
    toArticleRefs(supabase, relationshipRows.filter((r) => pillarSet.has(r.id))),
  ]);

  // --- Comparison siblings ------------------------------------------------
  let comparisonSiblings: { article: ArticleRef; sharedTags: string[] }[] = [];
  if (isComparison && comparisonCandidateIds.length > 0) {
    const tagSlugsByContentId = new Map<string, string[]>();
    for (const link of candidateTagLinks ?? []) {
      const t = tagById.get(link.tag_id);
      if (!t) continue;
      const list = tagSlugsByContentId.get(link.content_id) ?? [];
      list.push(t.slug);
      tagSlugsByContentId.set(link.content_id, list);
    }
    const ranked = rankComparisonSiblings(
      { id: content.id, tagSlugs, categoryId: content.category_id },
      (comparisonCandidates ?? []).map((c) => ({
        id: c.id,
        tagSlugs: tagSlugsByContentId.get(c.id) ?? [],
        categoryId: c.category_id,
        publishedAt: c.published_at,
      })),
      MAX_COMPARISON_SIBLINGS
    );
    const rankedById = new Map(ranked.map((r) => [r.id, r.sharedTags]));
    const siblingRows = (comparisonCandidates ?? []).filter((c) => rankedById.has(c.id));
    const siblingRefs = await toArticleRefs(supabase, siblingRows);
    // Restore the ranked order, which the `.filter` above does not preserve.
    const refById = new Map(siblingRefs.map((r) => [r.id, r]));
    comparisonSiblings = ranked.flatMap((r) => {
      const article = refById.get(r.id);
      return article ? [{ article, sharedTags: r.sharedTags }] : [];
    });
  }

  // --- Hub links ----------------------------------------------------------
  const hubs: ArticleHubLink[] = [];
  const familyById = new Map((allFamilies ?? []).map((f) => [f.id, f]));
  const seenFamilyIds = new Set<string>();
  for (const p of productRows ?? []) {
    // Only families reached through a PUBLISHED product of this article: the
    // product query above filters on is_published, so a family hub linked
    // here is guaranteed to render at least that product and can never be an
    // empty page.
    if (!p.family_id || seenFamilyIds.has(p.family_id)) continue;
    const family = familyById.get(p.family_id);
    if (!family) continue;
    seenFamilyIds.add(p.family_id);
    hubs.push({ label: family.name, path: `/families/${family.slug}`, kind: "family" });
  }

  // Brand hubs, matched by tag slug — the same slug-equality rule the brand
  // hub itself uses to find its coverage (see manufacturer-detail.ts
  // getBrandArticles), so the link is guaranteed to be reciprocal: if this
  // article shows the brand, the brand hub shows this article. No hand-written
  // manufacturer-to-tag mapping, deliberately.
  const manufacturerBySlug = new Map((allManufacturers ?? []).map((m) => [m.slug, m]));
  for (const tagSlug of subjectTags(tagSlugs)) {
    const manufacturer = manufacturerBySlug.get(tagSlug);
    if (!manufacturer) continue;
    hubs.push({ label: manufacturer.name, path: `/manufacturers/${manufacturer.slug}`, kind: "manufacturer" });
  }

  if (category) hubs.push({ label: category.name, path: `/${category.slug}`, kind: "category" });

  // --- Fallback "more like this" rail (unchanged behaviour) ---------------
  // Explicit editorial relationships rank first (real curation), then
  // shared-product association, then same-type recency as a last resort —
  // deduplicated so a piece related both ways only appears once. Anything
  // already shown as a cluster member, a pillar or a comparison sibling is
  // excluded, so the same piece never appears twice on one page.
  const alreadyShown = new Set<string>([
    ...clusterMemberRefs.map((r) => r.id),
    ...clusterPillarRefs.map((r) => r.id),
    ...comparisonSiblings.map((s) => s.article.id),
  ]);
  const relatedIds = new Set<string>();
  const related = [...relationshipRows, ...(relatedByProduct ?? []), ...(sameTypeContent ?? [])].filter((item) => {
    if (alreadyShown.has(item.id) || relatedIds.has(item.id)) return false;
    relatedIds.add(item.id);
    return true;
  });
  const relatedWithImages = await attachHeroImages(supabase, related.slice(0, 3), "content");

  return {
    content,
    category: category ?? null,
    products,
    tags,
    freshness: freshnessRows ?? [],
    sources: sourceRows ?? [],
    seo: seo ?? null,
    related: relatedWithImages,
    heroImage,
    // A "series" of one is just a link; labelling it as a series overstates
    // what exists. Below the threshold the pieces still surface through the
    // ordinary related rail.
    clusterMembers: clusterMemberRefs.length >= MIN_CLUSTER_MEMBERS ? clusterMemberRefs : [],
    clusterPillars: clusterPillarRefs,
    comparisonSiblings,
    hubs,
  };
});

async function toArticleRefs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: { id: string; title: string; slug: string; type: string; published_at: string | null }[]
): Promise<ArticleRef[]> {
  if (rows.length === 0) return [];
  const withExcerpts = await attachExcerpts(supabase, rows);
  const withImages = await attachHeroImages(supabase, withExcerpts, "content");
  return withImages.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    type: r.type,
    published_at: r.published_at,
    excerpt: r.excerpt,
    heroImage: r.heroImage,
  }));
}
