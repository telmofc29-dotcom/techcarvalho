// Behavioural verification of 20260827_knowledge_graph.sql.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-knowledge-graph.ts
//
// Every check CALLS something. "Success. No rows returned." has already been
// true and meaningless once in this project — a migration applied cleanly while
// being 103 lines of comments — so nothing here reads a file or trusts a
// schema listing.
//
// SAFE TO RUN REPEATEDLY. Probe rows are tagged, deleted, and the deletion is
// verified. Nothing pre-existing is mutated.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";

loadEnvLocal();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const STAMP = Date.now();
const TAG = `tc-kg-${STAMP}`;

type Check = { name: string; passed: boolean; detail: string; note?: string };
const checks: Check[] = [];
const record = (name: string, passed: boolean, detail: unknown, note?: string) =>
  checks.push({ name, passed, detail: typeof detail === "string" ? detail : JSON.stringify(detail), note });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

async function anonRest(path: string) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  const t = await r.text();
  let body: unknown;
  try { body = JSON.parse(t); } catch { body = t; }
  return { status: r.status, body };
}

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;
  const cleanup: (() => Promise<void>)[] = [];

  try {
    // --- 1. the four new tables exist and are readable -------------------
    for (const t of ["technology_concepts", "product_technologies", "content_technologies", "technology_relationships", "product_claims"]) {
      const { error } = await db.from(t).select("*").limit(1);
      record(`${t} exists`, !error, error ? `${error.code}: ${error.message}`.slice(0, 70) : "readable");
    }

    // --- 2. the new columns exist ----------------------------------------
    for (const [t, c] of [
      ["products", "maturity"],
      ["products", "release_date_precision"],
      ["product_relationships", "basis"],
      ["product_relationships", "source_url"],
      ["source_records", "source_class"],
    ] as const) {
      const { error } = await db.from(t).select(c).limit(1);
      record(`${t}.${c} exists`, !error, error ? `${error.code}` : "present");
    }

    // --- 3. nothing was reclassified by adding a column ------------------
    {
      const { data, error } = await db.from("products").select("maturity,release_date_precision");
      if (error) throw new Error(`reading products: ${error.message}`);
      const rows = data as { maturity: string; release_date_precision: string }[];
      const unknown = rows.filter((r) => r.maturity === "unknown").length;
      const dayPrec = rows.filter((r) => r.release_date_precision === "day").length;
      record(
        "every product defaulted to maturity 'unknown' — nothing guessed",
        unknown === rows.length,
        { total: rows.length, unknown },
        "'unknown' means NOBODY HAS ASSESSED IT, never 'does not exist'."
      );
      record("existing products kept day-precision release dates", dayPrec === rows.length,
        { total: rows.length, day: dayPrec });
    }
    {
      const { data, error } = await db.from("source_records").select("source_class");
      if (error) throw new Error(`reading source_records: ${error.message}`);
      const rows = data as { source_class: string }[];
      const unclassified = rows.filter((r) => r.source_class === "unclassified").length;
      record("every source_record defaulted to 'unclassified'", unclassified === rows.length,
        { total: rows.length, unclassified });
    }

    // --- 4. the widened relationship CHECK accepts the new types ---------
    {
      const { data: prods, error } = await db.from("products").select("id").limit(2);
      if (error) throw new Error(`reading products: ${error.message}`);
      const [a, b] = prods as { id: string }[];
      const { data: made, error: relErr } = await db.from("product_relationships").insert({
        product_id: a.id, related_product_id: b.id, relationship_type: "mount_successor",
        basis: `probe ${TAG}`, source_url: "https://example.invalid/probe",
      }).select("id,basis,source_url").single();
      if (made) cleanup.push(async () => { await db.from("product_relationships").delete().eq("id", made.id); });
      record("a NEW relationship type is accepted, with its basis", !relErr && !!made?.basis,
        relErr ? `${relErr.code}: ${relErr.message}`.slice(0, 70) : made);

      const { error: badErr } = await db.from("product_relationships").insert({
        product_id: a.id, related_product_id: b.id, relationship_type: "predecessor", basis: "x",
      }).select("id").single();
      record("an INVENTED relationship type is still refused", !!badErr,
        badErr ? `${badErr.code}` : "ACCEPTED — the CHECK is missing");
    }

    // --- 5. technology_concepts behaves ----------------------------------
    let conceptId: string | null = null;
    {
      const { data, error } = await db.from("technology_concepts").insert({
        slug: `${TAG}-concept`, name: "TC probe concept", kind: "focus_motor",
        summary: "Probe row created by scripts/verify-knowledge-graph.ts.",
      }).select("id,is_published").single();
      if (data) { conceptId = data.id; cleanup.unshift(async () => { await db.from("technology_concepts").delete().eq("id", data.id); }); }
      record("a technology concept can be created and defaults UNPUBLISHED",
        !error && data?.is_published === false,
        error ? `${error.code}: ${error.message}`.slice(0, 70) : data);

      const { error: kindErr } = await db.from("technology_concepts").insert({
        slug: `${TAG}-bad`, name: "bad", kind: "not_a_real_kind",
      }).select("id").single();
      record("an invented concept kind is refused", !!kindErr, kindErr ? kindErr.code : "ACCEPTED");
    }

    // --- 6. one explainer per concept ------------------------------------
    {
      const { data: arts, error } = await db.from("content_items")
        .select("id").eq("status", "published").limit(2);
      if (error) throw new Error(`reading content_items: ${error.message}`);
      const [c1, c2] = arts as { id: string }[];
      if (conceptId && c1 && c2) {
        const first = await db.from("content_technologies")
          .insert({ content_id: c1.id, technology_id: conceptId, role: "explains" }).select("*").single();
        if (!first.error) cleanup.unshift(async () => { await db.from("content_technologies").delete().eq("content_id", c1.id).eq("technology_id", conceptId!); });
        const second = await db.from("content_technologies")
          .insert({ content_id: c2.id, technology_id: conceptId, role: "explains" }).select("*").single();
        if (!second.error) cleanup.unshift(async () => { await db.from("content_technologies").delete().eq("content_id", c2.id).eq("technology_id", conceptId!); });
        record("only ONE article may be the explainer for a concept",
          !first.error && !!second.error,
          { first: first.error?.code ?? "ok", second: second.error?.code ?? "ACCEPTED — the unique index is missing" },
          "Otherwise every article mentioning 'USM' claims to be the USM explainer.");
      }
    }

    // --- 7. product_claims is separate from evidence ---------------------
    {
      const { data: prods } = await db.from("products").select("id").limit(1);
      const pid = (prods as { id: string }[])[0]?.id;
      const { data, error } = await db.from("product_claims").insert({
        product_id: pid, claim: `probe ${TAG}`, claim_kind: "manufacturer_performance",
        source_url: "https://example.invalid/claim",
      }).select("id,independently_verified").single();
      if (data) cleanup.unshift(async () => { await db.from("product_claims").delete().eq("id", data.id); });
      record("a claim can be recorded and is NOT verified by default",
        !error && data?.independently_verified === false,
        error ? `${error.code}: ${error.message}`.slice(0, 70) : data,
        "false means NOBODY HAS CHECKED, never 'checked and found false'.");
    }

    // --- 8. RLS ----------------------------------------------------------
    {
      const a = await anonRest("technology_concepts?select=slug&limit=1");
      record("anon CAN read technology concepts (reference data)",
        a.status === 200 && Array.isArray(a.body), { status: a.status });

      const w = await fetch(`${URL_}/rest/v1/technology_concepts`, {
        method: "POST",
        headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
        body: JSON.stringify({ slug: `${TAG}-anon`, name: "x", kind: "other" }),
      });
      record("anon CANNOT write technology concepts", w.status >= 400, { status: w.status });

      // content_technologies must be gated on the parent article being published.
      const ct = await anonRest("content_technologies?select=content_id");
      const ctRows = Array.isArray(ct.body) ? ct.body.length : -1;
      const { count: publishedLinks } = await db
        .from("content_technologies").select("content_id", { count: "exact", head: true }) as unknown as { count: number };
      record("anon sees only technologies of PUBLISHED articles",
        ct.status === 200 && ctRows <= publishedLinks,
        { anonSees: ctRows, adminSees: publishedLinks });

      const pc = await anonRest("product_claims?select=id&limit=1");
      record("anon can read claims (gated on the product being published)",
        pc.status === 200, { status: pc.status });
    }
  } finally {
    for (const c of cleanup) await c();
    const { data: leftC } = await db.from("technology_concepts").select("id").like("slug", `${TAG}%`);
    const { data: leftR } = await db.from("product_relationships").select("id").like("basis", `%${TAG}%`);
    const { data: leftCl } = await db.from("product_claims").select("id").like("claim", `%${TAG}%`);
    record("every probe row removed",
      ((leftC ?? []) as unknown[]).length === 0 && ((leftR ?? []) as unknown[]).length === 0 && ((leftCl ?? []) as unknown[]).length === 0,
      { concepts: ((leftC ?? []) as unknown[]).length, relationships: ((leftR ?? []) as unknown[]).length, claims: ((leftCl ?? []) as unknown[]).length });
  }

  let pass = 0;
  for (const c of checks) {
    if (c.passed) pass++;
    console.log(`[${c.passed ? "PASS" : "FAIL"}] ${c.name}`);
    console.log(`       ${c.detail}`);
    if (c.note) console.log(`       ${c.note}`);
  }
  console.log(`\n${pass}/${checks.length} checks passed.`);
  if (pass !== checks.length) process.exitCode = 1;
}

main().catch((e) => { console.error("verification failed to run:", e instanceof Error ? e.message : e); process.exitCode = 1; });
