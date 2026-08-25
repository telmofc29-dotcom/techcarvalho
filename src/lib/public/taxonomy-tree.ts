// THE CATEGORY TREE — parents aggregate, children stay narrow.
//
// WHAT PRODUCTION ACTUALLY LOOKED LIKE
// ------------------------------------
// `taxonomy_categories` has had a `parent_id` column since the initial schema
// and NOT ONE of the 12 rows used it. Every category was a top-level sibling,
// so "Camera Lenses" sat beside "Cameras & Photography" rather than under it,
// and every subject page matched `category_id` exactly.
//
// That is why /camera-lenses and /3d-printing rendered a full-page "Coming
// soon": not a routing bug, but 0 rows assigned to those categories and no
// hierarchy through which anything could be inherited.
//
// THE RULE, AND WHY IT IS ASYMMETRIC
// ----------------------------------
// A PARENT aggregates its descendants: /cameras-photography should surface lens
// coverage, because lens coverage is camera coverage.
//
// A CHILD does NOT inherit from its parent: /camera-lenses must not simply
// replay everything in /cameras-photography, or the child page is a duplicate
// of the parent wearing a narrower name — which is worse than an empty page,
// because it looks deliberate.
//
// So `descendantScope` walks DOWN only. There is deliberately no function here
// that walks up.
//
// PURE. No `server-only`, no Supabase. The caller supplies the rows.

export type CategoryNode = {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  sortOrder?: number;
};

/**
 * Every category whose content a page for `categoryId` should show: itself,
 * plus everything beneath it.
 *
 * Returns ids, in the order a reader would expect (self first, then children by
 * sort order), so a caller can pass them straight to `.in("category_id", ...)`.
 *
 * CYCLE-SAFE. `parent_id` is a self-referencing FK with nothing stopping a row
 * pointing at its own ancestor, and a cycle here would hang a page render. The
 * visited set makes that impossible rather than unlikely.
 */
export function descendantScope(categoryId: string, all: readonly CategoryNode[]): string[] {
  const childrenByParent = new Map<string, CategoryNode[]>();
  for (const c of all) {
    if (!c.parentId) continue;
    childrenByParent.set(c.parentId, [...(childrenByParent.get(c.parentId) ?? []), c]);
  }

  const out: string[] = [];
  const visited = new Set<string>();
  const walk = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    out.push(id);
    const kids = [...(childrenByParent.get(id) ?? [])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)
    );
    for (const kid of kids) walk(kid.id);
  };
  walk(categoryId);
  return out;
}

/** Direct children only, for rendering a parent page's sub-navigation. */
export function directChildren(
  categoryId: string,
  all: readonly CategoryNode[]
): CategoryNode[] {
  return all
    .filter((c) => c.parentId === categoryId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
}

export type Crumb = { slug: string; name: string };

/**
 * Breadcrumb trail from the root down to this category.
 *
 * Home is NOT included — that is the renderer's business, and baking it in here
 * would put a presentation decision in a data module.
 *
 * Cycle-safe for the same reason as above, and depth-capped so a malformed tree
 * degrades to a short trail rather than an infinite one.
 */
export function breadcrumbTrail(
  categoryId: string,
  all: readonly CategoryNode[],
  maxDepth = 6
): Crumb[] {
  const byId = new Map(all.map((c) => [c.id, c]));
  const trail: Crumb[] = [];
  const visited = new Set<string>();
  let current = byId.get(categoryId) ?? null;

  while (current && trail.length < maxDepth && !visited.has(current.id)) {
    visited.add(current.id);
    trail.unshift({ slug: current.slug, name: current.name });
    current = current.parentId ? (byId.get(current.parentId) ?? null) : null;
  }
  return trail;
}

/** True when this category has no parent. */
export function isTopLevel(categoryId: string, all: readonly CategoryNode[]): boolean {
  const node = all.find((c) => c.id === categoryId);
  return !!node && node.parentId === null;
}

/**
 * The intended hierarchy, as data.
 *
 * Kept deliberately SHALLOW — two levels. The owner asked for a logical tree,
 * not a deep one, and every additional level multiplies the number of pages
 * that can be empty.
 *
 * Only categories that already exist are listed; this maps existing slugs to
 * their parent slug and invents nothing. A slug absent from this map stays
 * top-level.
 */
export const INTENDED_PARENTS: Record<string, string> = {
  "camera-lenses": "cameras-photography",
  astrophotography: "cameras-photography",
  "action-cameras": "cameras-photography",
  "drones-fpv": "cameras-photography",
  "ai-hardware": "computing",
  "smart-home-robots": "computing",
};
