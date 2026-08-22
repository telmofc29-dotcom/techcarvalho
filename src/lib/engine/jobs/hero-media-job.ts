import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
import {
  classifyMediaTier, evaluateHero, inferSubjectKind,
  type ClassifiableAsset,
} from "@/lib/media/hierarchy";
import type { StageResult } from "./discovery";

type Client = Awaited<ReturnType<typeof createClient>>;
const JOB = "engine_hero_media";

// Standing check on hero-image quality.
//
// The audit that prompted it: of 81 published articles, 49 led with a
// generated title card and 29 with a data graphic. Only 3 showed real imagery.
// Someone arriving at an article about the PS5 saw a styled card reading
// "Gaming" instead of a PlayStation.
//
// Fixing those by hand fixes today. This runs every pass, so a page that
// publishes with a placeholder hero surfaces in the admin Media Requirements
// list rather than quietly becoming permanent.
//
// It is a QUALITY signal, not a rights or safety one:
//   * nothing is unpublished — a weak hero is not a reason to hide a page;
//   * an existing media_requirements row is never overwritten, because a
//     product blocked on having no photograph at all is a more urgent
//     problem than one that has a photo and wants a better one;
//   * `sourcing_status` is 'sourcing', never 'needed', so the count of
//     genuinely blocked media stays meaningful.
export async function runHeroMediaAudit(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  // Gated on `freshness` rather than a flag of its own: this is the same
  // family of check as orphan detection — is a published page actually
  // serving a reader properly — and adding a flag would mean a migration for
  // a switch nobody asked for.
  if (!(await isFlagEnabled(supabase, "freshness"))) {
    await recordJobRun(supabase, JOB, "skipped", counters, { reason: "freshness_disabled" });
    return { status: "skipped", ...counters };
  }

  // All readable as `anon`: RLS scopes each to published rows, which is
  // exactly the set this job cares about. A draft's hero is not a problem yet.
  const [entityResult, contentMediaResult, productMediaResult, assetResult, requirementResult] =
    await Promise.all([
      supabase.rpc("engine_existing_entities"),
      supabase.from("content_media").select("content_id, media_id, role").eq("role", "hero"),
      supabase.from("product_media").select("product_id, media_id, role").eq("role", "hero"),
      supabase
        .from("media_assets")
        .select("id, source_type, asset_role, owned, ai_generated, storage_path, source_url, license"),
      supabase.rpc("engine_open_media_requirements", { p_limit: 500 }),
    ]);

  const anyError =
    entityResult.error ?? contentMediaResult.error ?? productMediaResult.error ?? assetResult.error;
  if (anyError) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, anyError.message);
    return { status: "failed", ...counters, detail: { error: anyError.message } };
  }

  const entities = (entityResult.data ?? []) as {
    kind: string; id: string; name: string; slug: string; is_published: boolean;
  }[];
  const assets = new Map(
    ((assetResult.data ?? []) as (ClassifiableAsset & { id: string })[]).map((a) => [a.id, a])
  );
  const contentHero = new Map(
    (contentMediaResult.data ?? []).map((m) => [m.content_id, m.media_id])
  );
  const productHero = new Map(
    (productMediaResult.data ?? []).map((m) => [m.product_id, m.media_id])
  );

  // Anything already tracked is skipped without a write attempt. The RPC
  // guards this too, but not making the call keeps the counters honest about
  // how much work actually happened.
  const alreadyTracked = new Set(
    ((requirementResult.data ?? []) as { entity_id: string }[]).map((r) => r.entity_id)
  );

  const flagged: string[] = [];
  const tiers: Record<string, number> = {};
  let acceptable = 0;

  for (const entity of entities) {
    if (!entity.is_published) continue;
    counters.examined++;

    const isProduct = entity.kind === "product";
    const heroId = isProduct ? productHero.get(entity.id) : contentHero.get(entity.id);
    const asset = heroId ? assets.get(heroId) : null;

    const tier = classifyMediaTier(asset ?? null);
    tiers[tier] = (tiers[tier] ?? 0) + 1;

    // Content type is not carried by engine_existing_entities; the title-based
    // inference is enough to decide how strictly to judge, and this stage
    // never publishes anything on the strength of it.
    const subject = inferSubjectKind({ title: entity.name, isProduct });
    const verdict = evaluateHero(tier, subject);

    if (!verdict.shouldReplace) {
      acceptable++;
      continue;
    }
    if (alreadyTracked.has(entity.id)) {
      counters.deduped++;
      continue;
    }

    const { data: result, error } = await supabase.rpc("engine_flag_weak_hero", {
      p_content_id: isProduct ? null : entity.id,
      p_product_id: isProduct ? entity.id : null,
      p_tier: tier,
      p_reason: verdict.reason,
    });

    if (error) counters.failed++;
    else if (result === "created") {
      counters.created++;
      flagged.push(`${entity.slug} [${tier}]`);
    } else counters.deduped++;
  }

  // Every hero being acceptable is the goal, not an empty result.
  const status =
    counters.failed === 0
      ? "success"
      : counters.created + counters.deduped > 0
        ? "partial"
        : "failed";
  await recordJobRun(supabase, JOB, status, counters, { tiers, acceptable, flagged });
  return { status, ...counters, detail: { tiers, acceptable, flagged } };
}
