// What is ACTUALLY in production right now?
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-production-state.ts
//
// Run this before any expansion work. It does not read migration files or trust
// anybody's account of what was applied — it calls the things each migration
// creates and reports what answers.
//
// The five pending migrations are DETECTED, not assumed, because the honest
// answer to "did you apply it?" is frequently "I thought I did". One of them
// was applied and did nothing at all, and looked identical to success.
//
// READ-ONLY except where a probe is unavoidable, and every probe cleans up and
// re-checks. Nothing pre-existing is mutated.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";

loadEnvLocal();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const STAMP = Date.now();

type Row = { area: string; check: string; state: "OK" | "MISSING" | "FAIL"; detail: string };
const rows: Row[] = [];
const say = (area: string, check: string, state: Row["state"], detail: unknown) =>
  rows.push({ area, check, state, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }> };

async function anonRest(path: string) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  const t = await r.text();
  let body: unknown;
  try { body = JSON.parse(t); } catch { body = t; }
  return { status: r.status, body };
}

const MISSING_CODES = new Set(["PGRST202", "42883", "42P01", "42703", "PGRST204"]);

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;

  // ===================================================================
  // A. The five pending migrations — present or not?
  // ===================================================================

  // 1. 20260825b_normalise_double_encoded_specs_RUNNABLE.sql
  {
    const { data, error } = await db.from("product_specs").select("value");
    if (error) throw new Error(`reading product_specs failed: ${error.message}`);
    const all = data as { value: unknown }[];
    const dbl = all.filter((r) => typeof r.value === "string" && /^\s*"[\s\S]*"\s*$/.test(r.value));
    const kinds = new Map<string, number>();
    for (const r of all) {
      const v = r.value;
      kinds.set(v === null ? "null" : Array.isArray(v) ? "array" : typeof v,
        (kinds.get(v === null ? "null" : Array.isArray(v) ? "array" : typeof v) ?? 0) + 1);
    }
    const numericStrings = all.filter((r) => typeof r.value === "string" && /^\d+$/.test(r.value)).length;
    say("specs", "double-encoded values normalised", dbl.length === 0 ? "OK" : "MISSING",
      { total: all.length, stillDoubleEncoded: dbl.length, kinds: Object.fromEntries(kinds), numericStrings });
  }

  // 2. 20260826_assemble_draft_locale_slug.sql — detected by BEHAVIOUR.
  //    A pt row is created holding a slug, an approved brief asks the engine to
  //    assemble an ENGLISH article at that slug, and we see whether it refuses.
  {
    const slug = `tc-state-${STAMP}`;
    const cleanup: (() => Promise<void>)[] = [];
    try {
      const { data: en } = await db.from("content_items")
        .insert({ type: "news", title: "TC state probe src", slug: `${slug}-src`, body: "x", status: "draft" })
        .select("id").single();
      if (en) cleanup.push(async () => { await db.from("content_items").delete().eq("id", en.id); });

      const { data: pt } = en ? await db.from("content_items").insert({
        type: "news", title: "TC state probe pt", slug, body: null, status: "draft",
        locale: "pt", source_content_id: en.id, source_revision_seen: 1, translation_state: "draft",
      }).select("id").single() : { data: null };
      if (pt) cleanup.unshift(async () => { await db.from("content_items").delete().eq("id", pt.id); });

      const { data: brief } = await db.from("engine_briefs").insert({
        proposed_title: "TC state probe", proposed_slug: slug, content_type: "news",
        rationale: "probe", state: "planned", review_state: "approved",
      }).select("id").single();
      if (brief) cleanup.push(async () => { await db.from("engine_briefs").delete().eq("id", brief.id); });

      const { data, error } = brief ? await db.rpc("engine_assemble_draft", {
        p_brief_id: brief.id, p_title: "TC state probe", p_slug: slug, p_body: "probe",
        p_content_type: "news", p_category_slug: null, p_search_intent: null,
        p_primary_query: null, p_source_urls: [],
      }) : { data: null, error: { message: "no brief", code: "" } };

      const overRejected = data === "duplicate_slug";
      if (!overRejected && !error && typeof data === "string") {
        cleanup.unshift(async () => { await db.from("content_items").delete().eq("id", data); });
      }
      say("engine", "duplicate-slug guard understands locale", overRejected ? "MISSING" : "OK",
        overRejected ? "over-rejects: a pt slug blocks the English namespace" : `created (${String(data).slice(0, 8)}…)`);
    } finally {
      for (const c of cleanup) await c();
      const { data: left } = await db.from("content_items").select("id").like("slug", `${slug}%`);
      const { data: leftB } = await db.from("engine_briefs").select("id").like("proposed_slug", `${slug}%`);
      say("engine", "probe rows removed",
        ((left ?? []) as unknown[]).length === 0 && ((leftB ?? []) as unknown[]).length === 0 ? "OK" : "FAIL",
        { content: ((left ?? []) as unknown[]).length, briefs: ((leftB ?? []) as unknown[]).length });
    }
  }

  // 3. 20260825_contact_messages.sql
  {
    const { error } = await db.rpc("submit_contact_message", {
      p_name: "", p_email: "", p_subject: "", p_message: "",
    });
    const missing = MISSING_CODES.has(error?.code ?? "");
    say("contact", "submit_contact_message exists", missing ? "MISSING" : "OK",
      error ? `${error.code}: ${error.message}`.slice(0, 90) : "present (accepted an empty probe — check its validation)");

    if (!missing) {
      const t = await db.from("contact_messages").select("id", { count: "exact", head: true });
      say("contact", "contact_messages readable by admin", t.error ? "FAIL" : "OK",
        t.error ? t.error.message : `${(t as unknown as { count: number }).count} messages`);
      const a = await anonRest("contact_messages?select=id&limit=1");
      say("contact", "anon has NO table access", a.status === 200 && Array.isArray(a.body) && a.body.length === 0 ? "FAIL" : "OK",
        { status: a.status, code: (a.body as { code?: string })?.code ?? null });
    }
  }

  // 4. 20260825_author_profiles.sql
  {
    const { error } = await db.from("author_profiles").select("id").limit(1);
    const missing = MISSING_CODES.has(error?.code ?? "") || /author_profiles/.test(error?.message ?? "");
    say("authorship", "author_profiles exists", missing ? "MISSING" : "OK",
      error ? `${error.code}: ${error.message}`.slice(0, 80) : "present");
  }

  // 5. 20260825b_backfill_content_author_id.sql — never applied without approval.
  {
    const { data, error } = await db.from("content_items")
      .select("author_id").eq("locale", "en").eq("status", "published");
    if (error) throw new Error(`reading author_id failed: ${error.message}`);
    const withAuthor = (data as { author_id: string | null }[]).filter((r) => r.author_id !== null).length;
    say("authorship", "no unapproved author backfill happened", withAuthor === 0 ? "OK" : "FAIL",
      { publishedWithAuthor: withAuthor, of: (data as unknown[]).length });
  }

  // ===================================================================
  // B. Invariants that must hold regardless
  // ===================================================================

  {
    const { data, error } = await db.from("engine_settings").select("autonomous_publishing_enabled");
    say("autonomy", "autonomous publishing OFF",
      !error && (data as { autonomous_publishing_enabled: boolean }[])[0]?.autonomous_publishing_enabled === false ? "OK" : "FAIL",
      error ? error.message : (data as { autonomous_publishing_enabled: boolean }[])[0]);
  }
  {
    const r = await db.from("engine_change_log").select("id", { count: "exact", head: true });
    say("autonomy", "engine_change_log still empty", (r as unknown as { count: number }).count === 0 ? "OK" : "FAIL",
      { rows: (r as unknown as { count: number }).count });
  }
  {
    const en = await db.from("content_items").select("id", { count: "exact", head: true }).eq("locale", "en");
    const pub = await db.from("content_items").select("id", { count: "exact", head: true }).eq("status", "published");
    const { data: nonEn } = await db.from("content_items").select("slug,locale,status").neq("locale", "en");
    say("content", "published corpus unchanged",
      (pub as unknown as { count: number }).count === 81 ? "OK" : "FAIL",
      { english: (en as unknown as { count: number }).count, published: (pub as unknown as { count: number }).count });
    say("content", "no translation published",
      ((nonEn ?? []) as { status: string }[]).every((r) => r.status !== "published") ? "OK" : "FAIL",
      nonEn ?? []);
  }
  {
    const a = await anonRest("content_items?select=id&status=neq.published");
    say("rls", "anon cannot read unpublished content",
      a.status === 200 && Array.isArray(a.body) && a.body.length === 0 ? "OK" : "FAIL",
      { status: a.status, rows: Array.isArray(a.body) ? a.body.length : a.body });
  }
  {
    const a = await anonRest("media_assets?select=id&publication_status=neq.published&limit=1");
    say("rls", "anon cannot read unpublished media",
      a.status === 200 && Array.isArray(a.body) && a.body.length === 0 ? "OK" : "FAIL",
      { status: a.status, rows: Array.isArray(a.body) ? a.body.length : a.body });
  }

  // ===================================================================
  // C. Catalogue baseline — the BEFORE numbers for this phase
  // ===================================================================
  const counts: Record<string, number | string> = {};
  for (const t of [
    "manufacturers", "products", "product_families", "taxonomy_categories", "taxonomy_tags",
    "spec_definitions", "product_specs", "product_relationships", "source_records",
    "evidence_records", "media_assets", "content_items", "content_relationships",
    "content_products", "content_tags", "engine_briefs", "engine_sources", "engine_discoveries",
  ]) {
    const r = await db.from(t).select("id", { count: "exact", head: true });
    counts[t] = r.error ? `ERR ${r.error.code}` : (r as unknown as { count: number }).count;
  }

  // ---- report ----
  let ok = 0, missing = 0, fail = 0;
  let area = "";
  for (const r of rows) {
    if (r.area !== area) { area = r.area; console.log(`\n--- ${area.toUpperCase()} ---`); }
    if (r.state === "OK") ok++; else if (r.state === "MISSING") missing++; else fail++;
    console.log(`[${r.state.padEnd(7)}] ${r.check}`);
    console.log(`            ${r.detail}`);
  }
  console.log(`\n${ok} OK, ${missing} not yet applied, ${fail} FAILING`);

  console.log("\n--- CATALOGUE BASELINE ---");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${String(v).padStart(6)}  ${k}`);

  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("verification failed to run:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
