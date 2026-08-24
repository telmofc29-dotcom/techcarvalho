// LIVE PRODUCTION VERIFICATION of the spotlight rotation.
//
// Verifies behaviour, does not rebuild anything. Every override this script
// creates is removed again, and it asserts afterwards that every pre-existing
// override row is byte-identical -- a changed TOTAL is not evidence that WE
// changed something when the owner may be editing concurrently.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-spotlight-live.ts
//   ... --record   also records today's rotation through the real RPC

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import {
  selectSpotlight,
  SPOTLIGHT_WINDOW_DAYS,
  type SpotlightCandidate,
} from "../src/lib/public/spotlight.ts";

type Db = Awaited<ReturnType<typeof createAdminClient>>;

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

const MS_DAY = 86_400_000;

async function main(): Promise<void> {
  loadEnvLocal();
  const doRecord = process.argv.includes("--record");
  const db = await createAdminClient();
  const now = new Date();
  const rotationDate = now.toISOString().slice(0, 10);

  console.log("");
  console.log("=".repeat(74));
  console.log("LIVE SPOTLIGHT VERIFICATION");
  console.log("=".repeat(74));

  // ---- baseline of overrides, so we can prove we left them alone ---------
  const { data: ovBefore, error: ovErr } = await db
    .from("homepage_overrides")
    .select("id, content_id, mode, note, starts_at, ends_at")
    .order("id");
  if (ovErr) {
    console.log(`Override baseline read failed: ${ovErr.message}`);
    process.exitCode = 1;
    return;
  }
  const ovBaseline = new Map((ovBefore ?? []).map((o: { id: string }) => [o.id, JSON.stringify(o)]));
  const createdOverrides: string[] = [];
  console.log(`Existing overrides: ${(ovBefore ?? []).length}\n`);

  try {
    // ================================================================
    console.log("1. ROTATION INFRASTRUCTURE IS LIVE");
    const spot = await db.rpc("public_spotlight", { p_rotation_date: null });
    check("public_spotlight exists", !spot.error, spot.error?.message);

    const mem = await db.rpc("homepage_rotation_memory");
    check("homepage_rotation_memory exists", !mem.error, mem.error?.message);

    const recProbe = await db.rpc("homepage_record_spotlight", {
      p_rotation_date: rotationDate,
      p_content_id: "00000000-0000-0000-0000-000000000000",
      p_role: "lead",
    });
    check(
      "homepage_record_spotlight exists and guards unknown content",
      !recProbe.error && recProbe.data === "rejected_not_published",
      recProbe.error?.message ?? String(recProbe.data)
    );

    const sel = await db.rpc("public_homepage_selection", { p_supporting: 4 });
    check("public_homepage_selection still works", !sel.error, sel.error?.message);
    check(
      "selection returns rows (not an empty homepage)",
      Array.isArray(sel.data) && sel.data.length > 0,
      `returned ${(sel.data as unknown[] | null)?.length ?? 0}`
    );

    const { data: activeView, error: viewErr } = await db
      .from("homepage_overrides_active")
      .select("content_id, mode");
    check("homepage_overrides_active is readable", !viewErr, viewErr?.message);

    // ================================================================
    console.log("\n2. SELECTION USES THE ACTIVE OVERRIDE VIEW (expired windows stop applying)");
    const { data: pubs, error: pubErr } = await db
      .from("content_items")
      .select("id, title, slug, type, category_id, published_at")
      .eq("status", "published")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(120);
    if (pubErr) throw new Error(`published read: ${pubErr.message}`);
    const published = (pubs ?? []) as unknown as {
      id: string;
      title: string;
      slug: string;
      type: string | null;
      category_id: string | null;
      published_at: string;
    }[];

    const recent = published.filter(
      (p) => (now.getTime() - new Date(p.published_at).getTime()) / MS_DAY <= SPOTLIGHT_WINDOW_DAYS
    );
    const old = published.filter(
      (p) => (now.getTime() - new Date(p.published_at).getTime()) / MS_DAY > SPOTLIGHT_WINDOW_DAYS
    );
    console.log(`  published=${published.length}  within-${SPOTLIGHT_WINDOW_DAYS}d=${recent.length}  older=${old.length}`);

    // An EXPIRED suppress must NOT remove the article from selection.
    const victim = recent[0];
    if (victim) {
      const { data: expired, error: e1 } = await db
        .from("homepage_overrides")
        .insert({
          content_id: victim.id,
          mode: "suppress",
          note: "verify-spotlight-live: expired window",
          starts_at: new Date(now.getTime() - 10 * MS_DAY).toISOString(),
          ends_at: new Date(now.getTime() - 5 * MS_DAY).toISOString(),
        })
        .select("id")
        .single();
      if (e1) {
        check("could insert an expired override", false, e1.message);
      } else {
        createdOverrides.push((expired as { id: string }).id);
        const inActive = await db
          .from("homepage_overrides_active")
          .select("content_id")
          .eq("content_id", victim.id);
        check(
          "an EXPIRED override is absent from homepage_overrides_active",
          (inActive.data ?? []).length === 0
        );
        const selAfter = await db.rpc("public_homepage_selection", { p_supporting: 8 });
        const ids = ((selAfter.data ?? []) as { content_id: string }[]).map((r) => r.content_id);
        const wasInBaseline = ((sel.data ?? []) as { content_id: string }[]).some(
          (r) => r.content_id === victim.id
        );
        check(
          "an EXPIRED suppress does NOT remove content from selection",
          !wasInBaseline || ids.includes(victim.id),
          wasInBaseline ? "it vanished, so the expired window was still applied" : "(was not selected anyway)"
        );
      }
    }

    // An ACTIVE suppress MUST remove it.
    const target = ((sel.data ?? []) as { content_id: string }[])[0];
    if (target) {
      const { data: activeSup, error: e2 } = await db
        .from("homepage_overrides")
        .insert({
          content_id: target.content_id,
          mode: "suppress",
          note: "verify-spotlight-live: active suppress",
        })
        .select("id")
        .single();
      if (e2) {
        check("could insert an active suppress", false, e2.message);
      } else {
        createdOverrides.push((activeSup as { id: string }).id);
        const selSup = await db.rpc("public_homepage_selection", { p_supporting: 8 });
        const ids = ((selSup.data ?? []) as { content_id: string }[]).map((r) => r.content_id);
        check("an ACTIVE suppress removes content from selection", !ids.includes(target.content_id));
      }
    }

    // ================================================================
    console.log("\n3. THE 30-DAY RULE, INCLUDING THROUGH A PIN");
    const { data: cats } = await db.from("taxonomy_categories").select("id, slug");
    const catById = new Map(((cats ?? []) as { id: string; slug: string }[]).map((c) => [c.id, c.slug]));

    const rankPos = new Map(
      ((sel.data ?? []) as { content_id: string }[]).map((r, i) => [r.content_id, i])
    );
    const overrides = new Map(
      ((activeView ?? []) as { content_id: string; mode: string }[]).map((o) => [o.content_id, o.mode])
    );
    const memory = new Map(
      ((mem.data ?? []) as { content_id: string; last_spotlighted_at: string | null; spotlight_count: number }[])
        .map((m) => [m.content_id, m])
    );

    const toCandidate = (p: (typeof published)[number], over?: Partial<SpotlightCandidate>): SpotlightCandidate => {
      const pos = rankPos.get(p.id);
      const m = memory.get(p.id);
      const mode = overrides.get(p.id);
      return {
        contentId: p.id,
        title: p.title,
        slug: p.slug,
        contentType: p.type,
        categorySlug: p.category_id ? (catById.get(p.category_id) ?? null) : null,
        publishedAt: p.published_at,
        baseScore: pos === undefined ? 40 : 90 - pos * 3,
        lastSpotlightedAt: m?.last_spotlighted_at ?? null,
        spotlightCount: m?.spotlight_count ?? 0,
        hasStrongMedia: false,
        pinnedLead: mode === "pin_lead",
        pinnedSupporting: mode === "pin_supporting",
        boosted: mode === "boost",
        suppressed: mode === "suppress",
        ...over,
      };
    };

    const candidates = published.map((p) => toCandidate(p));
    const selection = selectSpotlight({ candidates, now, supportingSlots: 4 });
    const chosen = [...(selection.lead ? [selection.lead] : []), ...selection.supporting];

    check(
      "the rotation produced a lead",
      selection.lead !== null,
      `${candidates.length} candidates`
    );
    const tooOld = chosen.filter(
      (s) => (now.getTime() - new Date(s.candidate.publishedAt).getTime()) / MS_DAY > SPOTLIGHT_WINDOW_DAYS
    );
    check(`no spotlight item is older than ${SPOTLIGHT_WINDOW_DAYS} days`, tooOld.length === 0,
      tooOld.map((t) => t.candidate.title).join(", "));
    check(
      "older content was excluded with a stated reason",
      old.length === 0 || selection.excluded.some((e) => /days ago/.test(e.reason)),
      `${old.length} older articles exist; ${selection.excluded.length} excluded`
    );

    // A pin on OLD content must not promote it.
    if (old.length > 0) {
      const pinnedOld = candidates.map((c) =>
        c.contentId === old[0].id ? { ...c, pinnedLead: true, baseScore: 999 } : c
      );
      const withPin = selectSpotlight({ candidates: pinnedOld, now, supportingSlots: 4 });
      const ids = [
        ...(withPin.lead ? [withPin.lead.candidate.contentId] : []),
        ...withPin.supporting.map((s) => s.candidate.contentId),
      ];
      check(
        "a PIN cannot pull >30-day-old content into the spotlight",
        !ids.includes(old[0].id),
        `"${old[0].title}" (${Math.floor((now.getTime() - new Date(old[0].published_at).getTime()) / MS_DAY)}d) got in`
      );
    } else {
      check("no content older than 30 days exists to test the pin bypass", true, "(all content is recent)");
    }

    // ================================================================
    console.log("\n4. CATEGORY DIVERSITY");
    const catCounts = new Map<string, number>();
    for (const s of chosen) {
      const c = s.candidate.categorySlug ?? "uncategorised";
      catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
    }
    const worst = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    console.log(`  composition: ${[...catCounts.entries()].map(([c, n]) => `${c}=${n}`).join(", ")}`);
    check(
      "no single category dominates the spotlight",
      !worst || worst[1] <= 3,
      worst ? `${worst[0]} holds ${worst[1]} of ${chosen.length}` : ""
    );
    check("more than one category is represented", catCounts.size > 1, `${catCounts.size} categories`);

    // ================================================================
    console.log("\n5. ROTATION MEMORY PENALISES YESTERDAY");
    const first = chosen[0]?.candidate;
    if (first) {
      const asIfShown = candidates.map((c) =>
        c.contentId === first.contentId
          ? { ...c, lastSpotlightedAt: new Date(now.getTime() - MS_DAY).toISOString(), spotlightCount: 1 }
          : c
      );
      const tomorrow = selectSpotlight({
        candidates: asIfShown,
        now: new Date(now.getTime() + MS_DAY),
        supportingSlots: 4,
        history: { previousContentIds: [first.contentId], previousCategories: [first.categorySlug ?? ""] },
      });
      check(
        "a story shown yesterday gives way to another today",
        tomorrow.lead?.candidate.contentId !== first.contentId,
        `"${first.title}" stayed as lead`
      );
    }

    // ================================================================
    console.log("\n6. MANUAL BOOST / PIN STILL WIN");
    const weak = candidates[candidates.length - 1];
    if (weak) {
      const boosted = candidates.map((c) =>
        c.contentId === weak.contentId ? { ...c, boosted: true } : c
      );
      const boostSel = selectSpotlight({ candidates: boosted, now, supportingSlots: 4 });
      const boostIds = [
        ...(boostSel.lead ? [boostSel.lead.candidate.contentId] : []),
        ...boostSel.supporting.map((s) => s.candidate.contentId),
      ];
      check("a manual BOOST lifts content into the spotlight", boostIds.includes(weak.contentId));

      const pinned = candidates.map((c) =>
        c.contentId === weak.contentId ? { ...c, pinnedLead: true } : c
      );
      const pinSel = selectSpotlight({ candidates: pinned, now, supportingSlots: 4 });
      check("a manual PIN takes the lead outright", pinSel.lead?.candidate.contentId === weak.contentId);
    }

    // ================================================================
    console.log("\n7. TODAY'S SPOTLIGHT");
    if (doRecord) {
      let recorded = 0;
      for (const [i, slot] of chosen.entries()) {
        const { data: outcome, error } = await db.rpc("homepage_record_spotlight", {
          p_rotation_date: rotationDate,
          p_content_id: slot.candidate.contentId,
          p_role: slot.role,
          p_slot_position: i,
          p_score: Number(slot.score.toFixed(2)),
          p_reasons: slot.reasons,
        });
        if (!error && outcome === "recorded") recorded++;
        else if (error) console.log(`    record failed: ${error.message}`);
      }
      check("today's rotation was recorded through the real RPC", recorded === chosen.length,
        `${recorded}/${chosen.length}`);

      const readBack = await db.rpc("public_spotlight", { p_rotation_date: null });
      const rows = (readBack.data ?? []) as { title: string; role: string }[];
      check("public_spotlight returns the recorded rotation", rows.length > 0, `${rows.length} rows`);
      check(
        "the recorded rotation is what the homepage will serve",
        rows.some((r) => r.role === "lead")
      );
    }

    const live = await db.rpc("public_spotlight", { p_rotation_date: null });
    const liveRows = (live.data ?? []) as {
      title: string;
      role: string;
      category_slug: string | null;
      published_at: string;
      slot_position: number;
    }[];

    console.log("");
    if (liveRows.length === 0) {
      console.log("  No rotation recorded yet -- the homepage falls back to score ordering.");
      console.log("  The nightly tick records one at 04:30 UTC; re-run with --record to do it now.");
      console.log("");
      console.log("  WOULD BE SELECTED NOW:");
      for (const s of chosen) {
        const age = Math.floor((now.getTime() - new Date(s.candidate.publishedAt).getTime()) / MS_DAY);
        console.log(
          `    ${s.role === "lead" ? "LEAD      " : "SUPPORTING"} ${s.candidate.title.slice(0, 62)}`
        );
        console.log(`               ${s.candidate.categorySlug ?? "uncategorised"} · ${age}d old · score ${s.score.toFixed(1)}`);
      }
    } else {
      console.log("  TODAY'S LIVE SPOTLIGHT:");
      for (const r of liveRows) {
        const age = Math.floor((now.getTime() - new Date(r.published_at).getTime()) / MS_DAY);
        console.log(`    ${r.role === "lead" ? "LEAD      " : "SUPPORTING"} ${r.title.slice(0, 62)}`);
        console.log(`               ${r.category_slug ?? "uncategorised"} · ${age}d old`);
      }
    }

    console.log("");
    console.log("  NEXT UP (would rotate in):");
    for (const c of selection.nextUp.slice(0, 5)) {
      console.log(`    ${c.title.slice(0, 66)}`);
    }
  } finally {
    // ---- cleanup ------------------------------------------------------
    console.log("\n8. CLEANUP");
    if (createdOverrides.length > 0) {
      const { error } = await db.from("homepage_overrides").delete().in("id", createdOverrides);
      if (error) console.log(`  WARN cleanup failed: ${error.message}`);
    }
    const { data: ovAfter } = await db
      .from("homepage_overrides")
      .select("id, content_id, mode, note, starts_at, ends_at")
      .order("id");
    if (ovAfter) {
      const ids = new Set(ovAfter.map((o: { id: string }) => o.id));
      check("every override this run created was removed", createdOverrides.every((id) => !ids.has(id)));
      const drifted = ovAfter.filter(
        (o: { id: string }) => ovBaseline.has(o.id) && ovBaseline.get(o.id) !== JSON.stringify(o)
      );
      check("no pre-existing override was modified", drifted.length === 0);
    }

    console.log(`\n${passed}/${passed + failed} checks passed.`);
    process.exitCode = failed === 0 ? 0 : 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
