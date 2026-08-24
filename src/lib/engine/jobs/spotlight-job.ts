import "server-only";

// THE DAILY ROTATION STAGE.
//
// Runs once a night, computes the day's front page, records it. The homepage
// then reads that record all day, which is what makes the selection stable for
// a visitor and different tomorrow.
//
// IT DOES NOT RANK. `baseScore` comes from `public_homepage_selection` — the
// existing scoring, with its existing per-type half-lives — and is taken as
// given. This stage decides whose TURN it is among things already judged good.
//
// UNTIL THE MIGRATION IS APPLIED it runs, reports the rotation it computed, and
// reports that it could not persist. A stage that silently does nothing is
// exactly what this phase set out to remove.

import { createClient } from "@/lib/supabase/server";
import { recordJobRun, newCounters } from "../cron.ts";
import {
  selectSpotlight,
  type SpotlightCandidate,
  type SpotlightHistory,
} from "@/lib/public/spotlight";
import type { StageResult } from "./discovery.ts";

const JOB = "engine_spotlight";

/** Supporting positions. Follows the existing homepage layout rather than redesigning it. */
export const SUPPORTING_SLOTS = 4;

/** Candidates pulled from the ranking before rotation rules are applied. */
const CANDIDATE_POOL = 40;

export async function runSpotlightRotation(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<StageResult> {
  const counters = newCounters();
  const now = new Date();
  const rotationDate = now.toISOString().slice(0, 10);

  // ---- candidates, from the EXISTING ranking -----------------------------
  const { data: ranked, error: rankError } = await supabase.rpc("public_homepage_selection", {
    p_supporting: 8,
  });
  if (rankError) {
    await recordJobRun(supabase, JOB, "failed", counters, {
      reason: "ranking_read_failed",
      error: rankError.message,
    });
    return { status: "failed", ...counters, detail: { error: rankError.message } };
  }

  // The selection RPC returns only the current top few. For rotation we need a
  // wider field, so published content is read directly and the RPC's ordering
  // supplies the score signal for the ones it covers.
  const { data: published, error: pubError } = await supabase
    .from("content_items")
    .select("id, title, slug, type, category_id, published_at, status")
    .eq("status", "published")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(CANDIDATE_POOL);
  if (pubError) {
    await recordJobRun(supabase, JOB, "failed", counters, {
      reason: "content_read_failed",
      error: pubError.message,
    });
    return { status: "failed", ...counters, detail: { error: pubError.message } };
  }

  const rankedRows = (ranked ?? []) as unknown as {
    content_id: string;
    role: string;
    category_slug: string | null;
  }[];
  // Position in the ranking stands in for relative score: the RPC does not
  // return its score, and re-deriving it here would duplicate the scoring this
  // stage is careful not to own.
  const rankPosition = new Map(rankedRows.map((r, i) => [r.content_id, i]));

  // ---- categories --------------------------------------------------------
  const { data: cats } = await supabase.from("taxonomy_categories").select("id, slug");
  const categoryById = new Map(
    ((cats ?? []) as { id: string; slug: string }[]).map((c) => [c.id, c.slug])
  );

  // ---- rotation memory ---------------------------------------------------
  let memory = new Map<string, { last: string | null; count: number }>();
  let memoryAvailable = true;
  const { data: mem, error: memError } = await supabase.rpc("homepage_rotation_memory");
  if (memError) {
    memoryAvailable = false;
  } else {
    memory = new Map(
      ((mem ?? []) as { content_id: string; last_spotlighted_at: string | null; spotlight_count: number }[]).map(
        (m) => [m.content_id, { last: m.last_spotlighted_at, count: m.spotlight_count }]
      )
    );
  }

  // ---- overrides currently in force --------------------------------------
  const overrides = new Map<string, string>();
  const { data: ovRows } = await supabase
    .from("homepage_overrides_active")
    .select("content_id, mode");
  for (const o of (ovRows ?? []) as { content_id: string; mode: string }[]) {
    overrides.set(o.content_id, o.mode);
  }

  // ---- media readiness ---------------------------------------------------
  const { data: heroRows } = await supabase
    .from("content_media")
    .select("content_id, media_id, role, media_assets!inner(publication_status)")
    .eq("role", "hero");
  const withHero = new Set(
    ((heroRows ?? []) as unknown as {
      content_id: string;
      media_assets: { publication_status: string } | null;
    }[])
      .filter((r) => r.media_assets?.publication_status === "published")
      .map((r) => r.content_id)
  );

  const candidates: SpotlightCandidate[] = (
    (published ?? []) as unknown as {
      id: string;
      title: string;
      slug: string;
      type: string | null;
      category_id: string | null;
      published_at: string;
    }[]
  ).map((c) => {
    const mode = overrides.get(c.id);
    const pos = rankPosition.get(c.id);
    const m = memory.get(c.id);
    return {
      contentId: c.id,
      title: c.title,
      slug: c.slug,
      contentType: c.type,
      categorySlug: c.category_id ? (categoryById.get(c.category_id) ?? null) : null,
      publishedAt: c.published_at,
      // Ranked items get a score derived from their position; unranked
      // published content gets a floor rather than zero, so recent material the
      // top-N ranking did not reach can still take its turn.
      baseScore: pos === undefined ? 40 : 90 - pos * 3,
      lastSpotlightedAt: m?.last ?? null,
      spotlightCount: m?.count ?? 0,
      hasStrongMedia: withHero.has(c.id),
      pinnedLead: mode === "pin_lead",
      pinnedSupporting: mode === "pin_supporting",
      boosted: mode === "boost",
      suppressed: mode === "suppress",
    };
  });

  // ---- yesterday ---------------------------------------------------------
  let history: SpotlightHistory = { previousCategories: [], previousContentIds: [] };
  const { data: prev } = await supabase
    .from("homepage_spotlight_log")
    .select("content_id, rotation_date")
    .lt("rotation_date", rotationDate)
    .order("rotation_date", { ascending: false })
    .limit(SUPPORTING_SLOTS + 1);
  if (prev && prev.length > 0) {
    const ids = (prev as { content_id: string }[]).map((p) => p.content_id);
    history = {
      previousContentIds: ids,
      previousCategories: candidates
        .filter((c) => ids.includes(c.contentId))
        .map((c) => c.categorySlug)
        .filter((s): s is string => !!s),
    };
  }

  const selection = selectSpotlight({
    candidates,
    now,
    supportingSlots: SUPPORTING_SLOTS,
    history,
  });

  counters.examined = candidates.length;

  // ---- record ------------------------------------------------------------
  const slots = [...(selection.lead ? [selection.lead] : []), ...selection.supporting];
  let recorded = 0;
  let rpcMissing = false;
  for (const [i, slot] of slots.entries()) {
    const { data: outcome, error } = await supabase.rpc("homepage_record_spotlight", {
      p_rotation_date: rotationDate,
      p_content_id: slot.candidate.contentId,
      p_role: slot.role,
      p_slot_position: i,
      p_score: Number(slot.score.toFixed(2)),
      p_reasons: slot.reasons,
    });
    if (error) {
      if (/PGRST202|could not find the function/i.test(error.message)) rpcMissing = true;
      continue;
    }
    if (outcome === "recorded") {
      recorded++;
      counters.created++;
    }
  }

  const detail: Record<string, unknown> = {
    rotationDate,
    candidates: candidates.length,
    lead: selection.lead?.candidate.title ?? null,
    supporting: selection.supporting.map((s) => s.candidate.title),
    excluded: selection.excluded.length,
    excludedForAge: selection.excluded.filter((e) => /days ago/.test(e.reason)).length,
    nextUp: selection.nextUp.slice(0, 5).map((c) => c.title),
    recorded,
    memoryAvailable,
  };

  if (rpcMissing) {
    detail.blocked =
      "homepage_record_spotlight is not deployed " +
      "(supabase/migrations_pending/20260824_spotlight_rotation.sql). The rotation above was " +
      "computed but NOT persisted, so the homepage still uses unrotated ranking.";
    await recordJobRun(supabase, JOB, "partial", counters, detail);
    return { status: "partial", ...counters, detail };
  }

  await recordJobRun(supabase, JOB, "success", counters, detail);
  return { status: "success", ...counters, detail };
}
