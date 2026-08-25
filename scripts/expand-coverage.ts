// OVERNIGHT COVERAGE EXPANSION.
//
// For each subject: research it against the live source registry, decide what
// TechCarvalho should actually do about it, and — only where the decision is
// NEW_ARTICLE or SUPPORTING — create a brief and assemble a DRAFT through the
// existing engine RPCs.
//
// IT NEVER PUBLISHES. engine_assemble_draft hard-wires status='draft', and this
// script has no path to change that. Everything it makes waits for a human.
//
// IT NEVER INVENTS. Claims come from the extractor, hedges survive into the
// brief's `uncertainties`, and a subject with no corroboration produces
// NO_COVERAGE and a log line rather than an article.
//
// DUPLICATES ARE THE POINT. Every subject is compared against published
// content, drafts and the briefs already queued, so five reports of one
// development cannot become five pages.
//
//   npx tsx scripts/expand-coverage.ts --plan            (dry run, decisions only)
//   npx tsx scripts/expand-coverage.ts --apply           (create drafts)
//   npx tsx scripts/expand-coverage.ts --apply --limit 8
//   npx tsx scripts/expand-coverage.ts --apply --category computing

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { buildCorpus } from "../src/lib/engine/research/feed-index.ts";
import { researchDiscovery } from "../src/lib/engine/research/research-pipeline.ts";
import { fetchArticle } from "../src/lib/engine/research/article-fetch.ts";
import { subjectDomainsForText } from "../src/lib/engine/research/entity-model.ts";
import { assembleDraft, proposeSeo } from "../src/lib/engine/draft-assembly.ts";
import { proposeSlug } from "../src/lib/engine/entity-resolution.ts";
import { decideCoverage, type ExistingPiece, type CoverageDecision } from "../src/lib/engine/coverage-decision.ts";

/**
 * Subjects to investigate, by category.
 *
 * These are SUBJECTS, not claims. Nothing here asserts that a development
 * happened; each one is a question put to the source registry, and most will
 * come back NO_COVERAGE. That is the expected outcome and not a failure.
 *
 * Spread across every live category on purpose: a night spent entirely on
 * cameras would leave the rest of the site exactly as thin as it was.
 */
const SUBJECTS: { category: string; topics: string[] }[] = [
  { category: "cameras-photography", topics: [
    "Canon EOS R5 Mark II", "Nikon Z6 III", "Sony A7 V", "camera sensor size",
    "image stabilisation", "mirrorless autofocus", "camera firmware update",
  ]},
  { category: "camera-lenses", topics: [
    "Canon RF lens", "Nikon Z lens", "Sony E mount lens", "telephoto lens",
    "wide angle lens", "prime lens vs zoom", "lens compatibility adapter",
  ]},
  { category: "astrophotography", topics: [
    "Milky Way photography", "star tracker mount", "deep sky imaging",
    "lunar photography", "astrophotography camera settings", "light pollution filter",
  ]},
  { category: "computing", topics: [
    "AMD Ryzen", "Intel Core Ultra", "NVIDIA GeForce RTX", "NVMe SSD",
    "DDR5 memory", "PC cooling", "Windows update", "motherboard chipset",
  ]},
  { category: "networking", topics: [
    "Wi-Fi 7", "mesh router", "network attached storage", "Ethernet cable",
    "router firmware", "home network security",
  ]},
  { category: "gaming", topics: [
    "PlayStation 5", "Xbox Series X", "Nintendo Switch 2", "PC game performance",
    "game storage", "graphics settings",
  ]},
  { category: "smartphones", topics: [
    "Samsung Galaxy", "One UI", "Apple iPhone", "Android update",
    "smartphone camera sensor", "phone battery technology",
  ]},
  { category: "ai-hardware", topics: [
    "NPU laptop", "local AI model", "AI accelerator", "on-device AI",
  ]},
  { category: "drones-fpv", topics: [
    "DJI drone", "FPV drone", "drone camera gimbal",
  ]},
  { category: "action-cameras", topics: [
    "GoPro Hero", "action camera stabilisation", "Insta360",
  ]},
  { category: "smart-home-robots", topics: [
    "Matter smart home", "robot vacuum", "humanoid robot", "home automation hub",
  ]},
  { category: "3d-printing", topics: [
    "Bambu Lab printer", "Prusa printer", "PLA filament", "resin printing",
    "3D printer slicer", "3D print troubleshooting", "printer bed levelling",
  ]},
];

type Outcome = {
  subject: string;
  category: string;
  decision: CoverageDecision | "RESEARCH_FAILED";
  origins: number;
  claims: number;
  reason: string;
  createdContentId?: string;
  createdTitle?: string;
};

async function main(): Promise<void> {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");
  const limIdx = process.argv.indexOf("--limit");
  const limit = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : Number.POSITIVE_INFINITY;
  const catIdx = process.argv.indexOf("--category");
  const onlyCategory = catIdx >= 0 ? process.argv[catIdx + 1] : null;

  // BULK CREATION IS HELD TO A HIGHER BAR THAN THE ENGINE'S OWN.
  //
  // decide() will call one reputable origin "reported", which is right for a
  // topic an editor chose to pursue. It is the wrong bar for an unattended run
  // over sixty subjects: single-origin pieces are exactly the thin filler this
  // is supposed to avoid producing at scale. Two independent origins is the
  // floor for anything created without a human in the loop.
  const minIdx = process.argv.indexOf("--min-origins");
  const minOrigins = minIdx >= 0 ? Number(process.argv[minIdx + 1]) : 2;

  const db = await createAdminClient();

  // ---- existing coverage, read once -------------------------------------
  const [{ data: content }, { data: cats }, { data: makers }, { data: briefs }] = await Promise.all([
    db.from("content_items").select("id, title, slug, status, category_id, published_at"),
    db.from("taxonomy_categories").select("id, slug"),
    db.from("manufacturers").select("name"),
    db.from("engine_briefs").select("proposed_title, review_state"),
  ]);
  const catIdBySlug = new Map(((cats ?? []) as { id: string; slug: string }[]).map((c) => [c.slug, c.id]));
  const catSlugById = new Map(((cats ?? []) as { id: string; slug: string }[]).map((c) => [c.id, c.slug]));
  const knownMakers = ((makers ?? []) as { name: string }[]).map((m) => m.name);

  const existing: ExistingPiece[] = ((content ?? []) as {
    id: string; title: string; slug: string; status: string;
    category_id: string | null; published_at: string | null;
  }[]).map((c) => ({
    id: c.id, title: c.title, slug: c.slug, status: c.status,
    categorySlug: c.category_id ? (catSlugById.get(c.category_id) ?? null) : null,
    publishedAt: c.published_at,
  }));
  // Briefs already queued count as coverage-in-progress: proposing a second
  // piece on a subject already briefed is the same duplication one step earlier.
  for (const b of (briefs ?? []) as { proposed_title: string; review_state: string }[]) {
    if (b.review_state === "rejected") continue;
    existing.push({
      id: `brief:${b.proposed_title}`, title: b.proposed_title, slug: "",
      status: "draft", categorySlug: null, publishedAt: null,
    });
  }
  // Two different headlines can reduce to the same templated title, which is
  // how one run produced "Apple: what has been reported so far" twice. The
  // subject-level duplicate check cannot see that, because it compares
  // subjects and this collides at the TITLE.
  const usedTitles = new Set(
    ((content ?? []) as { title: string }[]).map((c) => c.title.toLowerCase().trim())
  );
  const takenSlugs = new Set(
    ((content ?? []) as { slug: string }[]).map((c) => c.slug)
  );

  console.log("");
  console.log("=".repeat(78));
  console.log(`COVERAGE EXPANSION  ${apply ? "(APPLYING)" : "(dry run)"}`);
  console.log("=".repeat(78));
  console.log(`existing coverage: ${existing.length} pieces (published, draft and briefed)`);

  const outcomes: Outcome[] = [];
  let created = 0;
  const corpusCache = new Map<string, Awaited<ReturnType<typeof buildCorpus>>>();

  for (const group of SUBJECTS) {
    if (onlyCategory && group.category !== onlyCategory) continue;
    console.log(`\n${"-".repeat(78)}\n${group.category.toUpperCase()}\n${"-".repeat(78)}`);

    if (!corpusCache.has(group.category)) {
      corpusCache.set(group.category, await buildCorpus(group.category));
    }
    const corpus = corpusCache.get(group.category)!;

    for (const subject of group.topics) {
      if (created >= limit) break;
      try {
        // ---- research ---------------------------------------------------
        const shortlist = researchDiscovery({
          title: subject,
          subjectDomains: subjectDomainsForText(subject),
          corpus: corpus.items,
          sourcesAttempted: corpus.attempted,
          sourcesRead: corpus.read,
          sourcesFailed: corpus.failed,
          knownMakers,
        });

        // Full text only for what actually matched, so a pass does not hit
        // every publisher for every subject.
        const articleText = new Map<string, { text: string; contentSource: "full_text" | "feed_summary"; note: string | null }>();
        for (const m of shortlist.matches.slice(0, 4)) {
          if (!m.item.link) continue;
          const got = await fetchArticle(m.item.link, `${m.item.title}. ${m.item.summary ?? ""}`);
          articleText.set(m.item.link, { text: got.text, contentSource: got.contentSource, note: got.note });
        }

        const result = researchDiscovery({
          title: subject,
          subjectDomains: subjectDomainsForText(subject),
          corpus: corpus.items,
          sourcesAttempted: corpus.attempted,
          sourcesRead: corpus.read,
          sourcesFailed: corpus.failed,
          knownMakers,
          articleText,
        });

        const origins = result.lineage.independentOrigins;
        const claims = result.claimBreakdown.total;

        // ---- decide -----------------------------------------------------
        // COMPARE THE SUBJECT, NOT THE TITLE.
        //
        // suggestTitle() produces a templated headline -- "X: what has been
        // reported so far" -- and comparing those compares the template.
        // Unrelated subjects scored 0.50-0.57 against each other purely on the
        // shared phrase, so the FIRST draft created in a run blocked every
        // other subject as a duplicate. The raw subjects score 0.000.
        const verdict = decideCoverage({
          subject,
          categorySlug: group.category,
          independentOrigins: origins,
          framing: result.decision.framing,
          claimCount: claims,
          existing,
        });

        const line = `  ${verdict.decision.padEnd(16)} ${String(origins).padStart(2)}org ${String(claims).padStart(3)}cl  ${subject}`;
        console.log(line);
        console.log(`       ${verdict.reasons[0]?.slice(0, 100) ?? ""}`);

        const outcome: Outcome = {
          subject, category: group.category, decision: verdict.decision,
          origins, claims, reason: verdict.reasons[0] ?? "",
        };

        // ---- create -----------------------------------------------------
        const creatable =
          verdict.decision === "NEW_ARTICLE" || verdict.decision === "SUPPORTING";
        if (creatable && origins < minOrigins) {
          console.log(`       held: ${origins} independent origin(s), ${minOrigins} required for unattended creation.`);
          outcome.decision = "NO_COVERAGE";
          outcome.reason = `Below the ${minOrigins}-origin floor for unattended creation.`;
          outcomes.push(outcome);
          continue;
        }

        if (creatable && apply) {
          const title = result.decision.suggestedTitle ?? subject;
          const facts: string[] = [];
          const uncertainties: string[] = [];
          for (const c of result.claims.slice(0, 14)) {
            const text = c.attributedTo ? `${c.attributedTo}: ${c.text}` : c.text;
            // Hedges survive: a hedged claim can never become a verified fact
            // by passing through this script.
            if (c.hedges.length > 0) uncertainties.push(`${text} [unconfirmed: ${c.hedges.join(", ")}]`);
            else facts.push(text);
          }
          if (facts.length === 0) {
            console.log("       skipped: every extracted claim was hedged, so there is no fact to build on.");
            outcome.decision = "NO_COVERAGE";
            outcome.reason = "All claims hedged.";
            outcomes.push(outcome);
            continue;
          }

          const sourceUrls = result.matches.map((m) => m.item.link).filter((u): u is string => !!u);
          const { data: briefRow, error: briefErr } = await db.from("engine_briefs").insert({
            proposed_title: title,
            rationale:
              `${origins} independent origin(s) reporting; TechCarvalho has no page on this. ` +
              `Publishers: ${result.matches.map((m) => m.item.source.organisation).join(", ")}.`,
            content_type: "news",
            category_slug: group.category,
            brief_kind: result.decision.framing === "confirmed" ? "breaking" : "explainer",
            freshness_sensitivity: "time_sensitive",
            verified_facts: facts,
            uncertainties,
            source_urls: sourceUrls,
            review_state: "approved",
            state: "planned",
            reviewed_at: new Date().toISOString(),
          }).select("id").single();

          if (briefErr || !briefRow) {
            console.log(`       brief failed: ${briefErr?.message}`);
            outcomes.push(outcome);
            continue;
          }

          const draft = assembleDraft({
            title, contentType: "news", categorySlug: group.category,
            primaryQuestion: `What has actually been reported about ${subject}?`,
            supportingQuestions: ["What is confirmed?", "What is still unknown?", "What does it mean in practice?"],
            verifiedFacts: facts, uncertainties, sourceUrls,
            suggestedStructure: ["What has been reported", "Why it matters", "What is not confirmed", "What to watch"],
            briefKind: "explainer", freshnessSensitivity: "time_sensitive",
            rationale: `Researched from ${origins} independent origin(s).`,
            relatedContent: [], relatedProducts: [],
          });

          if (usedTitles.has(title.toLowerCase().trim())) {
        console.log(`  TITLE TAKEN      ${title.slice(0, 56)}`);
        continue;
      }
      usedTitles.add(title.toLowerCase().trim());

      const seo = proposeSeo({ title, primaryQuestion: null });
          const slug = proposeSlug(title, takenSlugs);
          if (!slug) { outcomes.push(outcome); continue; }
          takenSlugs.add(slug);

          const { data: rpcOut, error: rpcErr } = await db.rpc("engine_assemble_draft", {
            p_brief_id: (briefRow as { id: string }).id,
            p_title: title, p_slug: slug, p_body: draft.body,
            p_content_type: "news", p_category_slug: group.category,
            p_search_intent: null, p_primary_query: null,
            p_source_urls: sourceUrls,
            p_meta_title: seo.metaTitle, p_meta_description: seo.metaDescription,
          });

          if (rpcErr) {
            console.log(`       assemble failed: ${rpcErr.message}`);
          } else if (typeof rpcOut === "string" && /^[0-9a-f-]{36}$/i.test(rpcOut)) {
            created++;
            outcome.createdContentId = rpcOut;
            outcome.createdTitle = title;
            console.log(`       DRAFT CREATED  ${title.slice(0, 62)}  /${slug}`);

            // Taxonomy: the RPC takes a category slug, but set the FK too so
            // subject pages and the parent/child scope find it.
            const catId = catIdBySlug.get(group.category);
            if (catId) await db.from("content_items").update({ category_id: catId }).eq("id", rpcOut);

            // The new draft counts as coverage immediately, so the next
            // subject in this run cannot duplicate it.
            // Recorded under the SUBJECT for duplicate purposes, for the same
            // reason: the template must never be what future comparisons see.
            existing.push({
              id: rpcOut, title: subject, slug, status: "draft",
              categorySlug: group.category, publishedAt: null,
            });
          } else {
            console.log(`       assemble returned: ${rpcOut}`);
          }
        }

        outcomes.push(outcome);
      } catch (err) {
        // One subject failing must never end the run.
        console.log(`  RESEARCH_FAILED  ${subject}: ${err instanceof Error ? err.message : String(err)}`);
        outcomes.push({
          subject, category: group.category, decision: "RESEARCH_FAILED",
          origins: 0, claims: 0, reason: String(err),
        });
      }
    }
  }

  // ---- summary -----------------------------------------------------------
  console.log(`\n${"=".repeat(78)}\nSUMMARY\n${"=".repeat(78)}`);
  const byDecision = new Map<string, number>();
  for (const o of outcomes) byDecision.set(o.decision, (byDecision.get(o.decision) ?? 0) + 1);
  for (const [d, n] of [...byDecision].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${d}`);
  }
  console.log(`\n  drafts created: ${created}`);

  const byCat = new Map<string, number>();
  for (const o of outcomes) {
    if (o.createdContentId) byCat.set(o.category, (byCat.get(o.category) ?? 0) + 1);
  }
  if (byCat.size > 0) {
    console.log("\n  by category:");
    for (const [c, n] of [...byCat].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)}  ${c}`);
  }
  if (!apply) console.log("\n  DRY RUN — nothing written. Re-run with --apply.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
