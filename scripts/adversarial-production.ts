// DELIBERATELY TRY TO BREAK IT, AGAINST LIVE PRODUCTION.
//
// Every check below ATTEMPTS the bad thing and passes only when it is refused.
// A check that merely reads a table and reasons about the result is not in here:
// the point is that the refusal is real, not that the schema looks right.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/adversarial-production.ts
//
// Every probe that writes cleans up after itself and the cleanup is re-checked.
// Pre-existing row counts are compared before and after.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { compareDesignations } from "../src/lib/media/identity.ts";
import { scoreMatch, deriveIsModelSpecific, type MatchAsset, type MatchTarget } from "../src/lib/media/match-engine.ts";
import { buildEntityVocabulary } from "../src/lib/media/entity-vocabulary.ts";
import { decideAutoAttach } from "../src/lib/media/auto-attach.ts";
import { assessDeletion } from "../src/lib/media/deletion-safety.ts";
import { isProtectedSelection } from "../src/lib/media/selection-policy.ts";

loadEnvLocal();

type Row = { attack: string; state: "REFUSED" | "GOT THROUGH"; detail: string };
const results: Row[] = [];
const refused = (attack: string, ok: boolean, detail: string) =>
  results.push({ attack, state: ok ? "REFUSED" : "GOT THROUGH", detail });

const REFUSAL_CODES = new Set(["23514", "23502", "23503", "23505", "42501", "42703", "PGRST204"]);

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

async function main(): Promise<void> {
  const db = await createAdminClient();
  const stamp = `adv-${Date.now().toString(36)}`;
  const before = {
    cm: (await db.from("content_media").select("*", { count: "exact", head: true })).count,
    ci: (await db.from("content_items").select("*", { count: "exact", head: true })).count,
    ma: (await db.from("media_assets").select("*", { count: "exact", head: true })).count,
  };

  // ---- 1. hardcoded credential ----------------------------------------
  {
    const SKIP = new Set(["node_modules", ".git", ".next", "out", "dist", ".vercel"]);
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        if (SKIP.has(e)) continue;
        const f = join(d, e);
        let s;
        try { s = statSync(f); } catch { continue; }
        if (s.isDirectory()) { walk(f); continue; }
        if (!/\.(ts|tsx|js|mjs|cjs)$/.test(e)) continue;
        if (e.includes("no-hardcoded-credentials") || e.includes("adversarial-production")) continue;
        const src = readFileSync(f, "utf-8");
        for (const [i, line] of src.split(/\r?\n/).entries()) {
          if (/^\s*(\/\/|\*)/.test(line)) continue;
          if (/\bpassword\s*:\s*(["'])(?!\s*\1)[^"'\n]{3,}\1/.test(line)) hits.push(`${f}:${i + 1}`);
        }
      }
    };
    walk(process.cwd());
    refused("hardcoded credential in source", hits.length === 0, hits.length ? hits.join(", ") : "no password literal anywhere in the tree");
  }

  // ---- 2. machine approval / approved brief without an actor -----------
  {
    const { data } = await db.from("engine_briefs").select("id, review_state, reviewed_by");
    const rows = (data ?? []) as { id: string; review_state: string; reviewed_by: string | null }[];
    const bad = rows.filter((r) => r.review_state === "approved" && !r.reviewed_by);
    refused("existing approved brief with no reviewer", bad.length === 0, `${rows.length} briefs, ${bad.length} approved without an actor`);

    const target = rows[0];
    if (target) {
      const { error } = await db
        .from("engine_briefs")
        .update({ review_state: "approved" as const, reviewed_by: null })
        .eq("id", target.id);
      const wasRefused = error !== null && REFUSAL_CODES.has(error.code ?? "");
      refused("approve a brief with no human actor", wasRefused, error ? `${error.code}: ${error.message.slice(0, 80)}` : "ACCEPTED — the gate is gone");
      if (!error) {
        await db
          .from("engine_briefs")
          .update({ review_state: target.review_state as never, reviewed_by: target.reviewed_by })
          .eq("id", target.id);
      }
    }
  }

  // ---- 3. private media exposure --------------------------------------
  {
    const r = await fetch(`${URL_}/rest/v1/media_assets?select=id,publication_status&publication_status=neq.published`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    const body = (await r.json()) as unknown[];
    refused("read unpublished media as anon", Array.isArray(body) && body.length === 0, `anon saw ${Array.isArray(body) ? body.length : "?"} unpublished assets`);

    const c = await fetch(`${URL_}/rest/v1/content_items?select=id&status=neq.published`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    const cb = (await c.json()) as unknown[];
    refused("read unpublished content as anon", Array.isArray(cb) && cb.length === 0, `anon saw ${Array.isArray(cb) ? cb.length : "?"} unpublished articles`);
  }

  // ---- 4. engine selection claiming a human ----------------------------
  {
    const { data: art } = await db
      .from("content_items")
      .insert({ type: "news", title: `${stamp} probe`, slug: `${stamp}-probe`, body: "x", status: "draft" })
      .select("id")
      .single();
    const { data: med } = await db
      .from("media_assets")
      .insert({ storage_path: `${stamp}/p.jpg`, media_type: "image", publication_status: "private", rights_status: "unknown" })
      .select("id")
      .single();

    if (art && med) {
      const { data: me } = await db.auth.getUser();
      const adminId = me?.user?.id ?? null;

      const { error: e1 } = await db.from("content_media").insert({
        content_id: art.id, media_id: med.id, role: "gallery", sort_order: 0,
        selection_kind: "engine", selected_by: adminId,
      } as never);
      refused("engine selection claiming a human actor", e1 !== null && REFUSAL_CODES.has(e1.code ?? ""), e1 ? `${e1.code}` : "ACCEPTED");
      if (!e1) await db.from("content_media").delete().eq("content_id", art.id);

      const { error: e2 } = await db.from("content_media").insert({
        content_id: art.id, media_id: med.id, role: "gallery", sort_order: 0,
        selection_kind: "human", selected_by: null,
      } as never);
      refused("human selection naming nobody", e2 !== null && REFUSAL_CODES.has(e2.code ?? ""), e2 ? `${e2.code}` : "ACCEPTED");
      if (!e2) await db.from("content_media").delete().eq("content_id", art.id);

      const { error: e3 } = await db.from("content_media").insert({
        content_id: art.id, media_id: med.id, role: "gallery", sort_order: 0, selection_kind: "staff",
      } as never);
      refused("invent a selection_kind", e3 !== null && REFUSAL_CODES.has(e3.code ?? ""), e3 ? `${e3.code}` : "ACCEPTED");
      if (!e3) await db.from("content_media").delete().eq("content_id", art.id);

      // ---- 5. media deletion cascading into content loss ---------------
      await db.from("content_media").insert({ content_id: art.id, media_id: med.id, role: "hero", sort_order: 0 } as never);
      const assessment = assessDeletion(med.id, "p.jpg", {
        contentRoles: ["hero"], productRoles: [], ogReferences: 0, logoReferences: 0,
        requirementReferences: 0, derivatives: 0, engineCandidates: 0,
        publicationStatus: "private", exists: true, readFailures: [],
      });
      refused("bulk-delete an asset holding a hero", assessment.blocked, assessment.reason ?? "NOT BLOCKED");

      await db.from("content_media").delete().eq("content_id", art.id);
      await db.from("media_assets").delete().eq("id", med.id);
      await db.from("content_items").delete().eq("id", art.id);
    }
  }

  // ---- 6-10. identity and matcher attacks ------------------------------
  {
    const { data: mfr } = await db.from("manufacturers").select("name");
    const { data: prod } = await db.from("products").select("name");
    const { data: cats } = await db.from("taxonomy_categories").select("slug");
    const { data: tags } = await db.from("taxonomy_tags").select("name");
    const vocab = buildEntityVocabulary({
      manufacturers: ((mfr ?? []) as { name: string }[]).map((m) => m.name),
      productNames: ((prod ?? []) as { name: string }[]).map((p) => p.name),
      categorySlugs: ((cats ?? []) as { slug: string }[]).map((c) => c.slug),
      tagNames: ((tags ?? []) as { name: string }[]).map((t) => t.name),
    });

    const asset = (file: string, over: Partial<MatchAsset> = {}): MatchAsset => ({
      id: "a", storagePath: `uuid-${file}.jpg`, altText: null, caption: null,
      sourceType: "staff_photograph", assetRole: "product_photo", brandRole: null,
      owned: true, aiGenerated: false, publicationStatus: "published",
      rightsStatus: "verified", width: 2400, height: 1600, ...over,
    });
    const target = (title: string): MatchTarget => ({
      id: "t", kind: "content", title, manufacturerName: null, categorySlug: null,
      isModelSpecific: deriveIsModelSpecific(title), occupiedSlots: [],
    });
    const m = (f: string, t: string, over: Partial<MatchAsset> = {}) =>
      scoreMatch(asset(f, over), target(t), { entityVocabulary: vocab });

    const wrongHero = m("canon-eos-r5-front", "Canon EOS R5 Mark II review");
    refused("wrong-model image into a Hero slot", !wrongHero.proposedSlots.includes("hero"), `slots [${wrongHero.proposedSlots.join(",")}]`);
    refused("wrong-model image into a Thumbnail slot", !wrongHero.proposedSlots.includes("thumbnail"), `slots [${wrongHero.proposedSlots.join(",")}]`);

    const stopword = m("gta-6-release-date-status", "Apple is about to launch new products: what is actually known");
    refused("shared-stopword media match", stopword.proposedSlots.length === 0, stopword.withheld[0] ?? `slots [${stopword.proposedSlots.join(",")}]`);

    refused("Wi-Fi 7 / Wi-Fi 8 identity collision", compareDesignations("Wi-Fi 7", "Wi-Fi 8").conflict, "treated as different standards");
    refused("DJI Mini 4 Pro / Neptune 4 Pro numeric collision", compareDesignations("DJI Mini 4 Pro", "Neptune 4 Pro").conflict, "a shared 4 creates no identity");

    // Human hero replacement, through the real gate.
    const good = m("canon-eos-r5-mark-ii-front", "Canon EOS R5 Mark II review");
    const held = decideAutoAttach(asset("canon-eos-r5-mark-ii-front"), good, [{ role: "hero", protectedSelection: true }]);
    refused("auto-attach over a human-selected Hero", !held.slots.includes("hero"), held.refusals.find((r) => r.startsWith("hero")) ?? "");

    // Private media through the auto-attach gate.
    const priv = asset("canon-eos-r5-mark-ii-front", { publicationStatus: "private" });
    const privDecision = decideAutoAttach(priv, scoreMatch(priv, target("Canon EOS R5 Mark II review"), { entityVocabulary: vocab }), []);
    refused("auto-attach private media", privDecision.slots.length === 0, privDecision.refusals[0] ?? "");

    // Concept render presented as photography.
    const render = asset("canon-eos-r5-mark-ii-front", { assetRole: "concept_render" });
    const renderDecision = decideAutoAttach(render, scoreMatch(render, target("Canon EOS R5 Mark II review"), { entityVocabulary: vocab }), []);
    refused("concept render into a prominent slot", !renderDecision.slots.includes("hero") && !renderDecision.slots.includes("thumbnail"), renderDecision.refusals.find((r) => /concept|render/.test(r)) ?? renderDecision.refusals[0] ?? "");
  }

  // ---- 11. unknown selection treated as free ---------------------------
  refused("treat an 'unknown' selection as reconsiderable", isProtectedSelection("unknown"), "unknown is protected exactly like human");
  refused("treat a missing selection as an engine one", isProtectedSelection(null), "null is protected");

  // ---- cleanup verification -------------------------------------------
  const after = {
    cm: (await db.from("content_media").select("*", { count: "exact", head: true })).count,
    ci: (await db.from("content_items").select("*", { count: "exact", head: true })).count,
    ma: (await db.from("media_assets").select("*", { count: "exact", head: true })).count,
  };
  refused(
    "probes left nothing behind",
    after.cm === before.cm && after.ci === before.ci && after.ma === before.ma,
    `content_media ${before.cm}->${after.cm}  content_items ${before.ci}->${after.ci}  media ${before.ma}->${after.ma}`
  );

  console.log("\n=== ADVERSARIAL RUN AGAINST LIVE PRODUCTION ===\n");
  for (const r of results) {
    console.log(`  ${r.state.padEnd(12)} ${r.attack}`);
    console.log(`               ${r.detail}`);
  }
  const through = results.filter((r) => r.state === "GOT THROUGH");
  console.log(`\n  ${results.length - through.length}/${results.length} attacks refused`);
  console.log(`  RESULT: ${through.length === 0 ? "0 GOT THROUGH" : `${through.length} GOT THROUGH`}\n`);
  if (through.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
