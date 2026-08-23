// Behavioural verification of the 2026-08-23/24 migrations.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-provenance-i18n.ts
//
// Neither the SQL editor's message nor the schema definition is evidence. Three
// migrations in this project have already applied cleanly while carrying
// defects that only fire when a function is CALLED.
//
// SAFE TO RUN REPEATEDLY. Probe rows are marked, deleted, and the remaining
// count re-checked. Nothing real is mutated.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";

loadEnvLocal();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const NIL = "00000000-0000-0000-0000-0000000000ff";
const STAMP = Date.now();
const PROBE_KEY = `tc-probe-provenance-${STAMP}`;

type Check = { name: string; passed: boolean; expected: string; actual: string; note?: string };
const checks: Check[] = [];
function record(name: string, expected: string, actual: unknown, passed: boolean, note?: string): void {
  checks.push({ name, expected, actual: typeof actual === "string" ? actual : JSON.stringify(actual), passed, note });
}

async function anonRpc(fn: string, args: Record<string, unknown> = {}) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}
const codeOf = (b: unknown) =>
  b && typeof b === "object" && !Array.isArray(b) ? ((b as { code?: string }).code ?? null) : null;

async function main(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await createAdminClient()) as unknown as { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }> };

  console.log("=== PROVENANCE + TRANSLATION — behavioural verification ===\n");

  // ======================================================================
  // A. engine_upsert_discovery — signature, overloads, persistence
  // ======================================================================

  // No stale overload: the 10-argument shape must still resolve unambiguously
  // (defaults cover the rest). A PGRST203 here means two candidates matched.
  {
    const { data, error } = await db.rpc("engine_upsert_discovery", {
      p_dedupe_key: `${PROBE_KEY}-ten`,
      p_title: "TC provenance probe (10-arg)",
      p_summary: "probe",
      p_discovery_type: "technology_news",
      p_category_slug: null,
      p_claim_status: "reported_secondary",
      p_confidence: 0.5,
      p_source_url: "https://example.invalid/tc-probe-ten",
      p_publisher: "Example",
      p_trust_level: "secondary",
    });
    record(
      "the 10-argument call still resolves to exactly ONE function",
      "a status string, not PGRST203",
      error ? `ERROR ${error.code ?? ""} ${error.message}` : data,
      !error && typeof data === "string",
      "A stale overload beside the new one would make every existing caller ambiguous."
    );
  }

  // The full shape persists all four new fields.
  let sourceId: string | null = null;
  {
    const { data: sources, error: srcErr } = await db
      .from("engine_sources").select("id,url,organisation").limit(1);
    if (srcErr) throw new Error(`reading engine_sources failed: ${srcErr.message}`);
    sourceId = (sources?.[0]?.id as string) ?? null;
    record("a real engine_sources row exists to attribute evidence to", "a source id", sourceId ?? "none", sourceId !== null);
  }

  {
    const { data, error } = await db.rpc("engine_upsert_discovery", {
      p_dedupe_key: PROBE_KEY,
      p_title: "TC provenance probe (full)",
      p_summary: "probe",
      p_discovery_type: "technology_news",
      p_category_slug: null,
      p_claim_status: "reported_secondary",
      p_confidence: 0.5,
      p_source_url: "https://example.invalid/tc-probe-full",
      p_publisher: "Example Publisher",
      p_trust_level: "secondary",
      p_source_id: sourceId,
      p_excerpt: "A recorded excerpt of the claim.",
      p_originates_from_url: "https://upstream.invalid/original-report",
      p_origin_examined: true,
    });
    record(
      "the 14-argument call is accepted",
      "a status string",
      error ? `ERROR ${error.code ?? ""} ${error.message}` : data,
      !error && typeof data === "string"
    );
  }

  // THE POINT: are the values actually IN the row, or silently dropped?
  {
    const { data: disc, error: dErr } = await db
      .from("engine_discoveries").select("id").eq("dedupe_key", PROBE_KEY).maybeSingle();
    if (dErr) throw new Error(`reading engine_discoveries failed: ${dErr.message}`);
    const discoveryId = (disc?.id as string) ?? null;

    const { data: ev, error: eErr } = discoveryId
      ? await db.from("engine_discovery_evidence")
          .select("source_id,excerpt,originates_from_url,origin_examined,publisher,url")
          .eq("discovery_id", discoveryId)
      : { data: [], error: null };
    if (eErr) throw new Error(`reading evidence failed: ${eErr.message}`);
    const row = (ev as Record<string, unknown>[])?.[0];

    record(
      "source_id, excerpt, originates_from_url and origin_examined are PERSISTED",
      "all four present on the evidence row",
      row ?? "no evidence row",
      !!row &&
        row.source_id === sourceId &&
        typeof row.excerpt === "string" &&
        row.originates_from_url === "https://upstream.invalid/original-report" &&
        row.origin_examined === true,
      "This is the SILENT_SUCCESS check: the RPC returning a status proves nothing about what landed."
    );

    record(
      "evidence is traceable back to the source registry",
      "source_id joins to engine_sources",
      row?.source_id ?? null,
      !!row && row.source_id === sourceId && sourceId !== null
    );
  }

  // origin_examined must distinguish "nobody looked" from "nothing to find".
  {
    const key = `${PROBE_KEY}-unexamined`;
    await db.rpc("engine_upsert_discovery", {
      p_dedupe_key: key, p_title: "TC probe unexamined", p_summary: "probe",
      p_discovery_type: "technology_news", p_category_slug: null,
      p_claim_status: "reported_secondary", p_confidence: 0.5,
      p_source_url: "https://example.invalid/tc-probe-unexamined",
      p_publisher: "Example", p_trust_level: "secondary",
      p_source_id: sourceId, p_excerpt: null,
      p_originates_from_url: null, p_origin_examined: false,
    });
    const { data: d } = await db.from("engine_discoveries").select("id").eq("dedupe_key", key).maybeSingle();
    const { data: ev } = d
      ? await db.from("engine_discovery_evidence").select("origin_examined,originates_from_url").eq("discovery_id", d.id)
      : { data: [] };
    const row = (ev as Record<string, unknown>[])?.[0];
    record(
      "origin_examined=false records 'nobody looked', distinct from 'nothing found'",
      "origin_examined false with a NULL origin",
      row ?? "none",
      !!row && row.origin_examined === false && row.originates_from_url === null,
      "Without this a never-checked claim and a checked-and-original claim are the same row."
    );
  }

  // Least privilege: the engine runs as anon and must still be able to call it.
  {
    const r = await anonRpc("engine_upsert_discovery", {
      p_dedupe_key: `${PROBE_KEY}-anon`, p_title: "TC anon probe", p_summary: "probe",
      p_discovery_type: "technology_news", p_category_slug: null,
      p_claim_status: "reported_secondary", p_confidence: 0.5,
      p_source_url: "https://example.invalid/tc-probe-anon",
      p_publisher: "Example", p_trust_level: "secondary",
    });
    record(
      "anon (the cron role) can still call engine_upsert_discovery",
      "not 42501",
      { status: r.status, code: codeOf(r.body), body: typeof r.body === "string" ? r.body : undefined },
      codeOf(r.body) !== "42501"
    );
  }
  {
    const r = await anonRpc("engine_discovery_evidence" as string, {});
    void r;
    const direct = await fetch(`${URL_}/rest/v1/engine_discovery_evidence?select=id`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    const body = await direct.json().catch(() => []);
    record(
      "anon CANNOT read the evidence table directly",
      "empty or denied — never the rows",
      { status: direct.status, rows: Array.isArray(body) ? body.length : codeOf(body) },
      !Array.isArray(body) || body.length === 0
    );
  }

  // ======================================================================
  // B. Translation model
  // ======================================================================
  {
    const { data, error } = await db.from("locales").select("code,bcp47,is_source,sort_order").order("sort_order");
    const rows = (data ?? []) as Record<string, unknown>[];
    record(
      "four locales exist, exactly one marked as source",
      "en/pt/es/fr with en as source",
      error ? `ERROR ${error.message}` : rows.map((r) => `${r.code}${r.is_source ? "*" : ""}`).join(","),
      !error && rows.length === 4 && rows.filter((r) => r.is_source).length === 1 &&
        (rows.find((r) => r.is_source)?.code === "en")
    );
  }

  {
    const { data, error } = await db
      .from("content_items")
      .select("id,locale,translation_group_id,source_content_id,translatable_revision")
      .eq("status", "published");
    const rows = (data ?? []) as Record<string, unknown>[];
    const nonEn = rows.filter((r) => r.locale !== "en");
    const noGroup = rows.filter((r) => !r.translation_group_id);
    record(
      "every published row carries a translation group and is English",
      "81 EN rows, 0 without a group, 0 non-EN",
      error ? `ERROR ${error.message}` : { total: rows.length, nonEn: nonEn.length, noGroup: noGroup.length },
      !error && rows.length > 0 && noGroup.length === 0 && nonEn.length === 0,
      "EN remains canonical and untouched; no locale page is falsely advertised."
    );
    // Each existing article is the root of its own single-member family.
    const selfRooted = rows.filter((r) => r.translation_group_id === r.id).length;
    record(
      "each existing article roots its own translation family",
      `${rows.length} self-rooted`,
      selfRooted,
      selfRooted === rows.length
    );
  }

  {
    // Identity fields must have NO per-locale counterpart anywhere.
    const { data, error } = await db.from("products").select("*").limit(1);
    const cols = Object.keys(((data ?? []) as Record<string, unknown>[])[0] ?? {});
    const localeish = cols.filter((c) => /locale|lang|_pt$|_es$|_fr$|translation/i.test(c));
    record(
      "products gained NO locale column — a model number cannot be translated",
      "no locale-ish column",
      error ? `ERROR ${error.message}` : localeish.length ? localeish : "none",
      !error && localeish.length === 0,
      "Structural: with nowhere to put a translated name, a translator cannot corrupt 'Canon EOS 60D'."
    );
  }

  {
    const { data, error } = await db.rpc("content_translation_status");
    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const withTranslation = rows.filter((r) => r.translation_id !== null).length;
    record(
      "the coverage report runs and shows every source x locale pair",
      "rows, all currently untranslated",
      error ? `ERROR ${error.code ?? ""} ${error.message}` : { pairs: rows.length, translated: withTranslation },
      !error && rows.length > 0 && withTranslation === 0
    );
  }

  {
    const r = await anonRpc("content_translation_status");
    record(
      "anon CANNOT read translation state",
      "denied, not zero rows",
      { status: r.status, code: codeOf(r.body) },
      r.status >= 400,
      "Editorial translation state is unpublished work in progress; an empty result would read as 'all translated'."
    );
  }

  // The revision trigger fires on PROSE, not on housekeeping.
  //
  // Creates its OWN draft rather than borrowing a real row. Every content_item
  // in this database is published, and mutating a live article's title to test
  // a trigger — even for a moment, even reverted — is not something a
  // verification script should do.
  {
    const probeSlug = `tc-revision-probe-${STAMP}`;
    const base = {
      type: "news",
      title: "TC revision trigger probe",
      slug: probeSlug,
      body: "Created by scripts/verify-provenance-i18n.ts and deleted immediately.",
      status: "draft",
    };

    // FIRST: can content be created AT ALL? The 2026-08-24 migration backfilled
    // translation_group_id for the 81 rows that existed and then set NOT NULL
    // without giving new rows a value, so this is the exact insert the admin's
    // "new article" form performs.
    const plain = await db
      .from("content_items").insert(base)
      .select("id,translation_group_id,translatable_revision").single();
    const plainOk = !plain.error && !!plain.data;
    record(
      "a new content row can be created without naming a translation group",
      "insert succeeds, row self-roots",
      plainOk ? plain.data : `${plain.error?.code} ${plain.error?.message}`,
      plainOk && plain.data.id === plain.data.translation_group_id,
      "This is what the admin 'new article' form, scripts/ingest-content.ts and engine_promote_draft all do."
    );

    // Whether or not that worked, the revision trigger still needs proving, so
    // fall back to supplying the group explicitly. Keeping these as two checks
    // stops a fix for one from hiding a failure in the other.
    const made = plainOk
      ? plain.data
      : (await db
          .from("content_items")
          .insert({ ...base, translation_group_id: crypto.randomUUID() })
          .select("id,translatable_revision,title,status")
          .single()).data;

    if (!made) {
      record("the revision counter tracks prose, not housekeeping", "a probe draft", "could not create one by either route", false);
    } else {
      const id = made.id as string;
      const before = made.translatable_revision as number;

      // Housekeeping: a status touch must NOT bump the counter, or every
      // translation would falsely go stale on an unrelated edit.
      await db.from("content_items").update({ status: "draft" }).eq("id", id);
      const { data: afterNoop } = await db.from("content_items").select("translatable_revision").eq("id", id).maybeSingle();

      // Prose: a title change MUST bump it.
      await db.from("content_items").update({ title: "TC revision trigger probe (edited)" }).eq("id", id);
      const { data: afterTitle } = await db.from("content_items").select("translatable_revision").eq("id", id).maybeSingle();

      // And a body change too.
      await db.from("content_items").update({ body: "Edited body." }).eq("id", id);
      const { data: afterBody } = await db.from("content_items").select("translatable_revision").eq("id", id).maybeSingle();

      const noopRev = (afterNoop as Record<string, unknown> | null)?.translatable_revision as number;
      const titleRev = (afterTitle as Record<string, unknown> | null)?.translatable_revision as number;
      const bodyRev = (afterBody as Record<string, unknown> | null)?.translatable_revision as number;

      record(
        "the revision counter ignores housekeeping and bumps on title AND body",
        "unchanged, +1, +1",
        { before, afterStatusTouch: noopRev, afterTitle: titleRev, afterBody: bodyRev },
        noopRev === before && titleRev === before + 1 && bodyRev === before + 2,
        "updated_at would falsely stale every translation on a status flip or a tag edit."
      );

      await db.from("content_items").delete().eq("id", id);
      const { data: gone } = await db.from("content_items").select("id").eq("slug", probeSlug);
      record("probe draft cleaned up", "0 leftover", { leftover: ((gone ?? []) as unknown[]).length }, ((gone ?? []) as unknown[]).length === 0);
    }
  }

  // ---- cleanup -----------------------------------------------------------
  {
    const { data: probes } = await db
      .from("engine_discoveries").select("id,dedupe_key").like("dedupe_key", "tc-probe-provenance-%");
    const ids = ((probes ?? []) as { id: string }[]).map((p) => p.id);
    if (ids.length > 0) {
      await db.from("engine_discovery_evidence").delete().in("discovery_id", ids);
      await db.from("engine_discoveries").delete().in("id", ids);
    }
    const { data: left } = await db
      .from("engine_discoveries").select("id").like("dedupe_key", "tc-probe-provenance-%");
    record(
      "probe discoveries cleaned up",
      "0 leftover",
      { leftover: ((left ?? []) as unknown[]).length },
      ((left ?? []) as unknown[]).length === 0
    );
  }

  console.log("");
  let failed = 0;
  for (const c of checks) {
    if (!c.passed) failed++;
    console.log(`[${c.passed ? "PASS" : "FAIL"}] ${c.name}`);
    console.log(`       expected ${c.expected}  |  got ${c.actual}`);
    if (c.note) console.log(`       ${c.note}`);
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("verification threw:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
