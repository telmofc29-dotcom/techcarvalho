import "server-only";

// Loads everything an approval package needs, then hands it to the pure
// builder. The shaping rules live in approval-package.ts; this file only
// fetches, and it fetches the SAME facts the executor will act on.
//
// One rule governs every read here: a failed query must never become a
// reassuring line on the package. The corpus read is the sharpest case — if it
// fails, `corpusKnown` goes false and the package says "could not be checked"
// instead of "no overlap found". An owner approving on the strength of a
// clearance that was never computed is precisely the failure this whole
// feature is supposed to prevent.

import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import { classifyBriefQuality } from "./brief-quality.ts";
import { buildApprovalPackage, type ApprovalPackage } from "./approval-package.ts";
import { proposeSeo } from "./draft-assembly.ts";
import { proposeSlug } from "./entity-resolution.ts";
import { titleSimilarity, NEAR_DUPLICATE_THRESHOLD } from "./dedupe.ts";

export type PackageLoad =
  | { ok: true; package: ApprovalPackage }
  | { ok: false; reason: string };

export async function loadApprovalPackage(briefId: string): Promise<PackageLoad> {
  const supabase = await createClient();

  const { data: brief, error: briefError } = await supabase
    .from("engine_briefs")
    .select(
      "id, proposed_title, proposed_slug, content_type, category_slug, rationale, primary_question, " +
        "verified_facts, uncertainties, source_urls, freshness_sensitivity, brief_kind, discovery_id, " +
        "opportunity_id, related_product_slugs, review_state, assembled_content_id, created_at"
    )
    .eq("id", briefId)
    .maybeSingle();

  if (briefError) {
    logQueryError("loadApprovalPackage brief", briefError);
    return { ok: false, reason: `Could not read the brief: ${briefError.message}` };
  }
  if (!brief) return { ok: false, reason: "That brief no longer exists." };

  const b = brief as unknown as {
    id: string;
    proposed_title: string;
    proposed_slug: string | null;
    content_type: string | null;
    category_slug: string | null;
    rationale: string;
    primary_question: string | null;
    verified_facts: string[] | null;
    uncertainties: string[] | null;
    source_urls: string[] | null;
    freshness_sensitivity: "breaking" | "time_sensitive" | "evergreen" | null;
    brief_kind: string | null;
    discovery_id: string | null;
    opportunity_id: string | null;
    related_product_slugs: string[] | null;
    review_state: string;
    assembled_content_id: string | null;
    created_at: string;
  };

  const relatedSlugs = b.related_product_slugs ?? [];

  const [contentRes, productRes, candidateRes] = await Promise.all([
    supabase.from("content_items").select("title, slug, status"),
    relatedSlugs.length > 0
      ? supabase.from("products").select("name, slug, is_published").in("slug", relatedSlugs)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("engine_media_candidates")
      .select("id", { count: "exact", head: true })
      .eq("state", "rights_review"),
  ]);

  // ---- corpus ------------------------------------------------------------
  let corpusKnown = true;
  const publishedTitles: string[] = [];
  const takenSlugs = new Set<string>();
  if (contentRes.error) {
    corpusKnown = false;
    logQueryError("loadApprovalPackage corpus", contentRes.error);
  } else {
    for (const c of (contentRes.data ?? []) as { title: string; slug: string; status: string }[]) {
      takenSlugs.add(c.slug);
      if (c.status === "published") publishedTitles.push(c.title);
    }
  }

  // ---- products ----------------------------------------------------------
  const existingProducts: { name: string; slug: string; isPublished: boolean }[] = [];
  const foundSlugs = new Set<string>();
  if (productRes.error) {
    logQueryError("loadApprovalPackage products", productRes.error);
  } else {
    for (const p of (productRes.data ?? []) as {
      name: string;
      slug: string;
      is_published: boolean;
    }[]) {
      existingProducts.push({ name: p.name, slug: p.slug, isPublished: p.is_published });
      foundSlugs.add(p.slug);
    }
  }
  // Only claimed as missing when the product read SUCCEEDED. A failed read
  // would otherwise report every named product as absent, which reads as a
  // catalogue gap rather than as a broken query.
  const missingProductSlugs = productRes.error
    ? []
    : relatedSlugs.filter((s) => !foundSlugs.has(s));

  // ---- slug --------------------------------------------------------------
  const slugTaken = b.proposed_slug !== null && takenSlugs.has(b.proposed_slug);
  const proposedSlug =
    b.proposed_slug && !slugTaken
      ? b.proposed_slug
      : proposeSlug(b.proposed_title, takenSlugs) || null;

  // ---- cannibalisation ---------------------------------------------------
  let cannibalisationMatch: { title: string; similarity: number } | null = null;
  if (corpusKnown) {
    for (const title of publishedTitles) {
      const similarity = titleSimilarity(b.proposed_title, title);
      if (similarity < NEAR_DUPLICATE_THRESHOLD) continue;
      if (!cannibalisationMatch || similarity > cannibalisationMatch.similarity) {
        cannibalisationMatch = { title, similarity };
      }
    }
  }

  const quality = classifyBriefQuality({
    id: b.id,
    title: b.proposed_title,
    briefKind: b.brief_kind,
    contentType: b.content_type,
    verifiedFacts: b.verified_facts ?? [],
    uncertainties: b.uncertainties ?? [],
    sourceUrls: b.source_urls ?? [],
    freshnessSensitivity: b.freshness_sensitivity,
    hasDiscovery: b.discovery_id !== null,
    hasOpportunity: b.opportunity_id !== null,
    createdAt: b.created_at,
    summary: b.rationale,
    existingTitles: corpusKnown ? publishedTitles : [],
  });

  const seo = proposeSeo({ title: b.proposed_title, primaryQuestion: b.primary_question });

  return {
    ok: true,
    package: buildApprovalPackage({
      briefId: b.id,
      title: b.proposed_title,
      contentType: b.content_type,
      categorySlug: b.category_slug,
      quality,
      primaryQuestion: b.primary_question,
      verifiedFacts: b.verified_facts ?? [],
      uncertainties: b.uncertainties ?? [],
      sourceUrls: b.source_urls ?? [],
      proposedSlug,
      slugTaken,
      metaTitle: seo.metaTitle,
      metaDescription: seo.metaDescription,
      existingProducts,
      missingProductSlugs,
      cannibalisationMatch,
      corpusKnown,
      mediaReady: false,
      mediaNeedsRightsReview: candidateRes.error ? 0 : (candidateRes.count ?? 0),
      alreadyAssembled: b.assembled_content_id !== null,
    }),
  };
}
