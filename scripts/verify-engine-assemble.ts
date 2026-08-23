// Does engine_assemble_draft actually CREATE a row under the new schema, and
// does its duplicate-slug guard understand locales?
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-engine-assemble.ts
//
// The main verification script only proved this RPC still resolves and rejects
// an unknown brief. That is the guard firing BEFORE the insert — it says nothing
// about whether the insert itself works, which is the whole question after a
// migration that broke every other insert into content_items.
//
// So this drives the function all the way through with a real approved brief.
//
// SAFE TO RUN REPEATEDLY. Everything it creates is tagged and removed, and the
// removal is checked rather than assumed.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";

loadEnvLocal();

const STAMP = Date.now();
const TAG = `tc-asm-${STAMP}`;

type Check = { name: string; passed: boolean; expected: string; actual: string; note?: string };
const checks: Check[] = [];
function record(name: string, expected: string, actual: unknown, passed: boolean, note?: string): void {
  checks.push({ name, expected, actual: typeof actual === "string" ? actual : JSON.stringify(actual), passed, note });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }> };

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;
  const briefIds: string[] = [];
  const contentIds: string[] = [];

  console.log("=== engine_assemble_draft — full-path verification ===\n");

  async function makeBrief(slug: string): Promise<string | null> {
    const { data, error } = await db
      .from("engine_briefs")
      .insert({
        proposed_title: `TC assemble probe ${slug}`,
        proposed_slug: slug,
        content_type: "news",
        rationale: "Probe brief created by scripts/verify-engine-assemble.ts.",
        state: "planned",
        review_state: "approved",
      })
      .select("id")
      .single();
    if (error) {
      console.error("could not create probe brief:", error.message);
      return null;
    }
    briefIds.push(data.id);
    return data.id;
  }

  // ---- 1. The happy path: does it actually insert? --------------------
  const slugA = `${TAG}-a`;
  {
    const briefId = await makeBrief(slugA);
    const { data, error } = briefId
      ? await db.rpc("engine_assemble_draft", {
          p_brief_id: briefId,
          p_title: "TC assemble probe A",
          p_slug: slugA,
          p_body: "Probe body.",
          p_content_type: "news",
          p_category_slug: null,
          p_search_intent: null,
          p_primary_query: null,
          p_source_urls: [],
        })
      : { data: null, error: { message: "no brief", code: "" } };

    record(
      "PATH 3 (full) — engine_assemble_draft CREATES a content row",
      "a success status, not rejected_* and not an error",
      error ? `ERROR ${error.code ?? ""} ${error.message}`.slice(0, 100) : data,
      !error && typeof data === "string" && !String(data).startsWith("rejected") && data !== "duplicate_slug",
      "The 2026-08-24 migration broke every other insert into content_items. This is the third path."
    );

    const { data: row, error: rowErr } = await db
      .from("content_items")
      .select("id,slug,locale,status,translation_group_id,source_content_id")
      .eq("slug", slugA)
      .maybeSingle();
    if (rowErr) throw new Error(`reading probe row failed: ${rowErr.message}`);
    if (row) contentIds.push(row.id);

    record(
      "the engine-created row is self-rooted, English and a DRAFT",
      "group == own id, locale en, status draft",
      row ?? "no row created",
      !!row && row.translation_group_id === row.id && row.locale === "en" &&
        row.status === "draft" && row.source_content_id === null,
      "status must be draft — the engine never publishes."
    );
  }

  // ---- 2. The locale question ----------------------------------------
  // Give an existing English row a Portuguese translation with a DIFFERENT
  // slug, then ask the engine to create an English article using that slug.
  //
  // A Portuguese slug does not occupy the English namespace: the unique index
  // is on (locale, slug). If the guard rejects this, it is over-rejecting and
  // will silently block legitimate English articles once translations exist.
  const ptSlug = `${TAG}-pt-only`;
  {
    const { data: en, error: enErr } = await db
      .from("content_items")
      .insert({ type: "news", title: "TC assemble probe source", slug: `${TAG}-src`, body: "x", status: "draft" })
      .select("id").single();
    if (enErr) throw new Error(`could not create source row: ${enErr.message}`);
    contentIds.push(en.id);

    const { data: pt, error: ptErr } = await db
      .from("content_items")
      .insert({
        type: "news", title: "TC assemble probe (pt)", slug: ptSlug, body: null, status: "draft",
        locale: "pt", source_content_id: en.id, source_revision_seen: 1, translation_state: "draft",
      })
      .select("id,slug,locale").single();
    if (ptErr) throw new Error(`could not create pt row: ${ptErr.message}`);
    contentIds.push(pt.id);

    const briefId = await makeBrief(ptSlug);
    const { data, error } = briefId
      ? await db.rpc("engine_assemble_draft", {
          p_brief_id: briefId,
          p_title: "TC assemble probe reusing a pt slug",
          p_slug: ptSlug,
          p_body: "Probe body.",
          p_content_type: "news",
          p_category_slug: null,
          p_search_intent: null,
          p_primary_query: null,
          p_source_urls: [],
        })
      : { data: null, error: { message: "no brief", code: "" } };

    const rejected = data === "duplicate_slug";
    if (!rejected && !error) {
      const { data: made } = await db.from("content_items").select("id").eq("slug", ptSlug).eq("locale", "en").maybeSingle();
      if (made) contentIds.push(made.id);
    }

    record(
      "the duplicate-slug guard understands LOCALE",
      "creates the English article — a pt slug does not occupy the en namespace",
      error ? `ERROR ${error.message}`.slice(0, 80) : data,
      !rejected,
      rejected
        ? "OVER-REJECTING: `where slug = p_slug` has no locale filter, so any translation's slug now blocks that slug for English. Cannot fire today (0 translations) but fires the moment the first one exists."
        : undefined
    );
  }

  // ---- 3. A genuine English collision must STILL be refused -----------
  {
    const briefId = await makeBrief(slugA);
    const { data, error } = briefId
      ? await db.rpc("engine_assemble_draft", {
          p_brief_id: briefId,
          p_title: "TC assemble probe duplicate",
          p_slug: slugA, // already taken by an ENGLISH row from step 1
          p_body: "Probe body.",
          p_content_type: "news",
          p_category_slug: null,
          p_search_intent: null,
          p_primary_query: null,
          p_source_urls: [],
        })
      : { data: null, error: { message: "no brief", code: "" } };
    record(
      "a real English slug collision is still refused",
      "duplicate_slug",
      error ? `ERROR ${error.message}`.slice(0, 80) : data,
      data === "duplicate_slug",
      "Loosening the guard must not make it accept a genuine collision."
    );
  }

  // ---- cleanup --------------------------------------------------------
  const errs: string[] = [];
  // Translations first — deleting a source while a translation points at it
  // trips content_items_translation_shape via `on delete set null`.
  const { data: rows } = await db.from("content_items").select("id,locale").like("slug", `${TAG}%`);
  const ordered = ((rows ?? []) as { id: string; locale: string }[])
    .sort((a, b) => Number(b.locale !== "en") - Number(a.locale !== "en"));
  for (const r of ordered) {
    const { error } = await db.from("content_items").delete().eq("id", r.id);
    if (error) errs.push(`content ${r.id}: ${error.message}`);
  }
  for (const id of briefIds) {
    const { error } = await db.from("engine_briefs").delete().eq("id", id);
    if (error) errs.push(`brief ${id}: ${error.message}`);
  }
  void contentIds;

  const { data: leftC } = await db.from("content_items").select("id").like("slug", `${TAG}%`);
  const { data: leftB } = await db.from("engine_briefs").select("id").like("proposed_slug", `${TAG}%`);
  record(
    "everything created was removed",
    "0 content, 0 briefs, no delete errors",
    { content: ((leftC ?? []) as unknown[]).length, briefs: ((leftB ?? []) as unknown[]).length, errors: errs.length ? errs : "none" },
    ((leftC ?? []) as unknown[]).length === 0 && ((leftB ?? []) as unknown[]).length === 0 && errs.length === 0
  );

  const { count } = await db.from("content_items").select("id", { count: "exact", head: true }).eq("locale", "en") as unknown as { count: number };
  record("the English corpus is back to 81", "81", { count }, count === 81);

  let pass = 0;
  for (const c of checks) {
    if (c.passed) pass++;
    console.log(`[${c.passed ? "PASS" : "FAIL"}] ${c.name}`);
    console.log(`       expected ${c.expected}  |  got ${c.actual}`);
    if (c.note) console.log(`       ${c.note}`);
  }
  console.log(`\n${pass}/${checks.length} checks passed.`);
  if (pass !== checks.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("verification failed to run:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
