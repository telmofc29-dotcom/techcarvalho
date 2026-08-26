import Link from "next/link";
import { Card } from "@/components/admin/ui";
import { Badge } from "@/components/shared/ui";
import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import { loadAssetSuggestions, loadMediaNeeds } from "@/lib/media/suggestion-service";
import { assessPriority } from "@/lib/engine/priority-entities";
import { partitionOpportunities, isWatchlistOpportunity, type OpportunityRow } from "@/lib/engine/opportunity-list";

// EDITORIAL WORK, GROUPED — the one screen the owner actually operates from.
//
// WHAT IT IS NOT
// --------------
// Not a system dashboard. Counting rows is what the specialist pages already
// do, and a wall of totals is what made the owner open twelve of them. Every
// group here is a KIND OF DECISION, and each one links to the place that
// decision gets made.
//
// It is also deliberately shallow: a count, the two or three most useful
// examples, and a way in. Dumping the full payload onto the front page would
// recreate the problem one level up.
//
// FAILURE IS REPORTED, NOT SWALLOWED
// ----------------------------------
// Every group can fail independently, and a group that could not be read says
// so rather than rendering zero. "Nothing needs your attention" is the most
// reassuring thing this page can say and it must never say it because a query
// broke.

type Group = {
  key: string;
  title: string;
  count: number;
  href: string;
  hint: string;
  examples: string[];
  /**
   * Why each example is where it is, positionally aligned with `examples`.
   * Optional: most groups have no ordering worth explaining, and inventing a
   * justification for a plain list would be worse than showing none.
   */
  notes?: string[];
  tone: "green" | "amber" | "blue" | "neutral";
  failed?: string;
};

export async function WorkPanel() {
  const supabase = await createClient();

  const [draftsRes, briefsRes, proposalsRes, oppsRes, mediaSug, mediaNeeds] = await Promise.all([
    supabase
      .from("content_items")
      .select("id, title, status, updated_at")
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("engine_briefs")
      .select("id, proposed_title, review_state, assembled_content_id")
      .eq("review_state", "approved")
      .is("assembled_content_id", null)
      .limit(50),
    supabase
      .from("engine_update_proposals")
      .select("id, summary, reason, state")
      .eq("state", "open")
      .limit(50),
    supabase
      .from("engine_opportunities")
      .select("subject_type, subject_key, label, score, explanation, inputs"),
    loadAssetSuggestions({ limit: 60, onlyUnattached: true }).catch(() => null),
    loadMediaNeeds({ limit: 80 }).catch(() => null),
  ]);

  if (draftsRes.error) logQueryError("WorkPanel drafts", draftsRes.error);
  if (briefsRes.error) logQueryError("WorkPanel briefs", briefsRes.error);
  if (proposalsRes.error) logQueryError("WorkPanel proposals", proposalsRes.error);
  if (oppsRes.error) logQueryError("WorkPanel opportunities", oppsRes.error);

  const rawDrafts = (draftsRes.data ?? []) as { id: string; title: string; updated_at: string }[];

  // PRIORITY DECIDES WHAT THE OWNER SEES FIRST.
  //
  // Newest-first is not an editorial order: it puts an Elegoo filament note
  // above an Apple launch purely because it arrived later. Ranking the queue by
  // the same watchlist assessment used to find these stories means the three
  // examples on this card are the three most worth opening.
  //
  // The score is an ordering key and is deliberately never shown. It is not a
  // measurement of anything, and printing a number invites reading it as one.
  // The REASON is shown instead, because that is the part that is true.
  // Ties are common and must not be resolved arbitrarily: most tier 1 launches
  // score identically, and Array.sort on equal keys leaves whatever order the
  // query happened to return. That made the top of this card change between
  // reloads. Recency is the tiebreak, so the order is stable and explainable.
  const drafts = rawDrafts
    .map((d) => ({ ...d, priority: assessPriority({ headline: d.title, alreadyCovered: false }) }))
    .sort(
      (a, b) =>
        b.priority.score - a.priority.score ||
        Date.parse(b.updated_at) - Date.parse(a.updated_at)
    );

  const tierOneDrafts = drafts.filter((d) => d.priority.tier === 1).length;
  const approvedUnbuilt = (briefsRes.data ?? []) as { proposed_title: string }[];
  const proposals = (proposalsRes.data ?? []) as { summary: string | null; reason: string }[];

  // OPPORTUNITIES ARE PARTITIONED, NEVER SORTED TOGETHER.
  //
  // Twelve category rows carry score = NULL because the scoring job refused to
  // guess a demand figure it cannot measure — the honest answer. PostgreSQL
  // puts NULLs FIRST on `order by score desc`, so ranking them in one list
  // would have shown twelve unscored sections above every urgent, fully-scored
  // development. partitionOpportunities keeps the two apart so an unscored row
  // cannot outrank a scored one, because they are never in the same list.
  const { ranked: rankedOpps, awaitingData: unscoredOpps } = partitionOpportunities(
    (oppsRes.data ?? []) as OpportunityRow[]
  );
  const watchlistOpps = rankedOpps.filter(isWatchlistOpportunity);

  // UPCOMING LAUNCHES get their own card. A scheduled launch is the one thing
  // here that can be PREPARED rather than reacted to, and burying it among
  // developments that have already happened wastes the only lead time the
  // queue ever offers.
  //
  // Only assertable schedules qualify. A rumoured date is still shown among
  // developments, framed as a rumour — it is not promoted into a calendar.
  const scheduled = watchlistOpps.filter((o) => {
    const i = (o.inputs ?? {}) as Record<string, unknown>;
    return i.upcoming === true && i.dateAssertable === true;
  });

  // A strong match is one the matcher would attach: an exact-model pairing on
  // an image currently doing nothing.
  const strongMatches =
    mediaSug?.suggestions.filter((s) => s.matches.some((m) => m.strength === "high")) ?? [];
  const answerable = mediaNeeds?.needs.filter((n) => n.candidates.length > 0) ?? [];
  const needNewImage = mediaNeeds?.needs.filter((n) => n.candidates.length === 0) ?? [];

  const groups: Group[] = [
    {
      // FIRST CARD: what is happening in the world that we do not cover.
      // Drafts are work already captured; these are the stories still
      // uncaptured, which is the more time-sensitive decision.
      key: "developments",
      title: "Developments worth covering",
      count: watchlistOpps.length,
      href: "/admin/engine/opportunities",
      hint:
        unscoredOpps.length > 0
          ? `Ranked by evidence and significance. ${unscoredOpps.length} section-level signal${unscoredOpps.length === 1 ? "" : "s"} are unscored and listed separately — there is not enough measured demand to rank them.`
          : "Ranked by evidence and significance, highest first.",
      examples: watchlistOpps.slice(0, 3).map((o) => o.label.replace(/&#\d+;/g, "'")),
      notes: watchlistOpps.slice(0, 3).map((o) => {
        const i = (o.inputs ?? {}) as Record<string, unknown>;
        const bits = [
          i.confirmation ? String(i.confirmation).toUpperCase() : null,
          i.significance ? String(i.significance).replace(/_/g, " ") : null,
          i.independentOrigins ? `${i.independentOrigins} source(s)` : null,
          i.isSubject === false ? "company is only a component" : null,
        ].filter(Boolean);
        return bits.join(" · ");
      }),
      tone: watchlistOpps.length > 0 ? "blue" : "neutral",
      failed: oppsRes.error?.message,
    },
    {
      key: "upcoming",
      title: "Upcoming launches",
      count: scheduled.length,
      href: "/admin/engine/opportunities",
      hint:
        "Announced or confirmed schedules. These can be prepared before the day — the only lead time the queue offers. Rumoured dates are NOT here; they stay with developments, framed as rumours.",
      examples: scheduled.slice(0, 3).map((o) => o.label.replace(/&#\d+;/g, "'")),
      notes: scheduled.slice(0, 3).map((o) => {
        const i = (o.inputs ?? {}) as Record<string, unknown>;
        return String(i.timingReason ?? "Announced as upcoming.");
      }),
      tone: scheduled.length > 0 ? "amber" : "neutral",
      failed: oppsRes.error?.message,
    },
    {
      key: "drafts",
      title: "Drafts ready for review",
      count: drafts.length,
      href: "/admin/content?status=draft",
      hint:
        tierOneDrafts > 0
          ? `Assembled from research, highest priority first. ${tierOneDrafts} involve${tierOneDrafts === 1 ? "s" : ""} a top-tier watchlist entity.`
          : "Assembled from research. Each needs editing and a publish decision.",
      examples: drafts.slice(0, 3).map((d) => d.title),
      notes: drafts.slice(0, 3).map((d) => d.priority.reason),
      tone: drafts.length > 0 ? "green" : "neutral",
      failed: draftsRes.error?.message,
    },
    {
      key: "briefs",
      title: "Approved, not yet built",
      count: approvedUnbuilt.length,
      href: "/admin/engine/briefs",
      hint: "You approved these; assembly has not produced a draft yet.",
      examples: approvedUnbuilt.slice(0, 3).map((b) => b.proposed_title),
      tone: approvedUnbuilt.length > 0 ? "amber" : "neutral",
      failed: briefsRes.error?.message,
    },
    {
      key: "updates",
      title: "Update existing rather than publish again",
      count: proposals.length,
      href: "/admin/engine/update-proposals",
      hint: "Something already covered has changed. Updating keeps the authority on one URL.",
      examples: proposals.slice(0, 3).map((p) => p.summary ?? p.reason),
      tone: proposals.length > 0 ? "blue" : "neutral",
      failed: proposalsRes.error?.message,
    },
    {
      key: "strong-media",
      title: "Unused images with a strong match",
      count: strongMatches.length,
      href: "/admin/media/suggestions",
      hint: "Attached to nothing, and the matcher is confident where they belong.",
      examples: strongMatches.slice(0, 3).map(
        (s) => `${fileName(s.asset.storagePath)} → ${s.matches[0]?.target.title ?? ""}`
      ),
      tone: strongMatches.length > 0 ? "green" : "neutral",
      failed: mediaSug === null ? "Media suggestions could not be read." : undefined,
    },
    {
      key: "awaiting-media",
      title: "Pages awaiting media",
      count: answerable.length + needNewImage.length,
      href: "/admin/media/suggestions",
      hint: `${answerable.length} answerable from the library today, ${needNewImage.length} need an image that does not exist.`,
      examples: answerable.slice(0, 3).map((n) => n.target.title),
      tone: answerable.length > 0 ? "amber" : "neutral",
      failed: mediaNeeds === null ? "Media needs could not be read." : undefined,
    },
  ];

  const totalDecisions = groups.reduce((n, g) => n + g.count, 0);

  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Editorial work
        </h2>
        <span className="text-xs text-neutral-500 tabular-nums">
          {totalDecisions} decision{totalDecisions === 1 ? "" : "s"} waiting
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <Card key={g.key} className="p-5">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <Link
                href={g.href}
                className="text-sm font-medium text-neutral-900 underline underline-offset-4 hover:text-neutral-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
              >
                {g.title}
              </Link>
              <Badge tone={g.count > 0 ? g.tone : "neutral"}>{g.count}</Badge>
            </div>

            {g.failed ? (
              <p className="text-sm text-amber-700">
                Could not be read: {g.failed}. This is not the same as zero.
              </p>
            ) : (
              <>
                <p className="text-xs text-neutral-500">{g.hint}</p>
                {g.examples.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {g.examples.map((e, i) => (
                      <li key={i} className="text-xs text-neutral-600">
                        <span className="block truncate">{e}</span>
                        {g.notes?.[i] && (
                          <span className="block truncate text-[11px] text-neutral-400">
                            {g.notes[i]}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function fileName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/^[0-9a-f-]{36}-/i, "");
}
