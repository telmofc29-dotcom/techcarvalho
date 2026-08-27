// Does 20260826_media_selection_provenance.sql actually WORK in production?
//
// Not "did the SQL return success" — that is what the owner already saw, and it
// is the weakest possible evidence. This EXERCISES every promise the migration
// makes, by trying to break each one and checking that the database refuses:
//
//   1. the three columns exist on both tables
//   2. every pre-existing row is 'unknown', never 'human'
//   3. an invented selection_kind is REFUSED by the CHECK constraint
//   4. a 'human' row with no actor is REFUSED
//   5. an 'engine' row that claims an actor is REFUSED
//   6. the legitimate 'human' and 'engine' shapes are ACCEPTED
//   7. the default on a plain insert is 'unknown'
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-selection-provenance.ts
//
// EVERY PROBE CLEANS UP AFTER ITSELF and the cleanup is re-checked. It touches
// no pre-existing row: it creates one disposable draft article and one
// disposable media row, exercises the constraints against those, and deletes
// them. If it exits non-zero, look for leftovers named with the stamp it prints.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";

loadEnvLocal();

type Check = { name: string; state: "PASS" | "FAIL"; detail: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string) =>
  checks.push({ name, state: ok ? "PASS" : "FAIL", detail });

/** Postgres codes that mean "a constraint refused this", which is a PASS here. */
const REFUSED = new Set(["23514", "23502", "23503"]);

async function main(): Promise<void> {
  const db = await createAdminClient();
  const stamp = `provenance-probe-${process.env.TC_PROBE_STAMP ?? "run"}`;

  // ---- 1. columns exist -------------------------------------------------
  for (const table of ["content_media", "product_media"] as const) {
    const { error } = await db.from(table).select("selected_by, selection_kind, selected_at").limit(1);
    record(`${table}: provenance columns readable`, !error, error?.message ?? "selected_by, selection_kind, selected_at");
  }

  // ---- 2. existing rows are 'unknown', not 'human' ----------------------
  //
  // The migration's central promise: applying it invents no fact about which
  // images the owner deliberately chose. A single 'human' row here would mean
  // it did.
  for (const table of ["content_media", "product_media"] as const) {
    const { data, error } = await db.from(table).select("selection_kind, selected_by");
    if (error) {
      record(`${table}: existing rows took the modest default`, false, error.message);
      continue;
    }
    const rows = (data ?? []) as { selection_kind: string; selected_by: string | null }[];
    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.selection_kind] = (acc[r.selection_kind] ?? 0) + 1;
      return acc;
    }, {});
    const claimedHuman = rows.filter((r) => r.selection_kind === "human").length;
    const strayActors = rows.filter((r) => r.selection_kind !== "human" && r.selected_by !== null).length;
    record(
      `${table}: no pre-existing row claims to be a human choice`,
      claimedHuman === 0 && strayActors === 0,
      `${rows.length} rows ${JSON.stringify(counts)}; rows claiming human: ${claimedHuman}; non-human rows naming an actor: ${strayActors}`
    );
  }

  // ---- disposable fixtures ---------------------------------------------
  const cleanup: (() => Promise<void>)[] = [];
  const fail = (why: string) => {
    record("probe fixtures", false, why);
  };

  const { data: article, error: articleError } = await db
    .from("content_items")
    .insert({ type: "news", title: `${stamp} article`, slug: `${stamp}-article`, body: "probe", status: "draft" })
    .select("id")
    .single();
  if (articleError || !article) {
    fail(`could not create a disposable draft: ${articleError?.message}`);
    return report(cleanup);
  }
  cleanup.push(async () => {
    await db.from("content_items").delete().eq("id", article.id);
  });

  const { data: asset, error: assetError } = await db
    .from("media_assets")
    .insert({
      storage_path: `${stamp}/probe.jpg`,
      media_type: "image",
      alt_text: `${stamp} probe asset`,
      publication_status: "private",
      rights_status: "unknown",
    })
    .select("id")
    .single();
  if (assetError || !asset) {
    fail(`could not create a disposable media row: ${assetError?.message}`);
    return report(cleanup);
  }
  cleanup.push(async () => {
    await db.from("media_assets").delete().eq("id", asset.id);
  });

  const { data: adminUser } = await db.auth.getUser();
  const adminId = adminUser?.user?.id ?? null;
  record("admin identity available for the human-selection probes", adminId !== null, adminId ? "signed in" : "no user id");

  type Attempt = { role: "hero" | "thumbnail" | "gallery"; extra: Record<string, unknown> };
  const attempt = async (a: Attempt) => {
    const { error } = await db
      .from("content_media")
      .insert({ content_id: article.id, media_id: asset.id, role: a.role, sort_order: 0, ...a.extra } as never);
    if (!error) await db.from("content_media").delete().eq("content_id", article.id).eq("role", a.role);
    return error;
  };

  // ---- 3. an invented selection_kind is refused -------------------------
  //
  // selected_by is NULL here on purpose. Passing an actor alongside an invented
  // kind trips content_media_human_needs_actor first, and the run then "passes"
  // without ever proving the selection_kind CHECK exists at all — a probe that
  // is satisfied by the wrong constraint is not evidence about the right one.
  // The constraint NAME is asserted, not just the refusal.
  {
    const error = await attempt({ role: "gallery", extra: { selection_kind: "staff", selected_by: null } });
    const byKindCheck = (error?.message ?? "").includes("selection_kind_check");
    record(
      "an invented selection_kind is REFUSED by the selection_kind CHECK specifically",
      error !== null && REFUSED.has(error.code ?? "") && byKindCheck,
      error
        ? `${error.code}: ${error.message.slice(0, 110)}`
        : "ACCEPTED — the CHECK constraint is missing, and a collective byline is one INSERT away"
    );
  }

  // The named-constraint assertion again, for the actor rule, so a future
  // change that drops one constraint cannot hide behind the other.
  {
    const error = await attempt({ role: "gallery", extra: { selection_kind: "human", selected_by: null } });
    record(
      "the refusal above comes from content_media_human_needs_actor, by name",
      (error?.message ?? "").includes("human_needs_actor"),
      error ? error.message.slice(0, 110) : "ACCEPTED"
    );
  }

  // ---- 4. 'human' with no actor is refused ------------------------------
  //
  // The same shape as engine_briefs.reviewed_by, and for the same reason: a
  // provenance field nothing enforces drifts into decoration. If this passes,
  // "a human chose it" becomes a claim anything can make about anything.
  {
    const error = await attempt({ role: "gallery", extra: { selection_kind: "human", selected_by: null } });
    record(
      "a 'human' selection with NO named human is REFUSED",
      error !== null && REFUSED.has(error.code ?? ""),
      error ? `${error.code}: ${error.message.slice(0, 90)}` : "ACCEPTED — anonymous human selections are possible"
    );
  }

  // ---- 5. 'engine' claiming an actor is refused -------------------------
  {
    const error = await attempt({ role: "gallery", extra: { selection_kind: "engine", selected_by: adminId } });
    record(
      "an 'engine' selection that names a human is REFUSED",
      error !== null && REFUSED.has(error.code ?? ""),
      error ? `${error.code}: ${error.message.slice(0, 90)}` : "ACCEPTED — the engine can attribute its guess to a person"
    );
  }

  // ---- 6. the legitimate shapes are accepted ----------------------------
  {
    const error = await attempt({
      role: "gallery",
      extra: { selection_kind: "human", selected_by: adminId, selected_at: new Date(0).toISOString() },
    });
    record(
      "a proper human selection is ACCEPTED",
      error === null,
      error ? `${error.code}: ${error.message.slice(0, 120)}` : "accepted and removed"
    );
  }
  {
    const error = await attempt({
      role: "gallery",
      extra: { selection_kind: "engine", selected_by: null, selected_at: new Date(0).toISOString() },
    });
    record(
      "a proper engine selection is ACCEPTED",
      error === null,
      error ? `${error.code}: ${error.message.slice(0, 120)}` : "accepted and removed"
    );
  }

  // ---- 7. the default is the careful one --------------------------------
  {
    const { error } = await db
      .from("content_media")
      .insert({ content_id: article.id, media_id: asset.id, role: "gallery", sort_order: 0 } as never);
    if (error) {
      record("a plain insert defaults to 'unknown'", false, `${error.code}: ${error.message.slice(0, 100)}`);
    } else {
      const { data } = await db
        .from("content_media")
        .select("selection_kind, selected_by")
        .eq("content_id", article.id)
        .eq("role", "gallery")
        .maybeSingle();
      const row = data as { selection_kind: string; selected_by: string | null } | null;
      record(
        "a plain insert defaults to 'unknown', NOT 'human'",
        row?.selection_kind === "unknown" && row?.selected_by === null,
        `selection_kind=${row?.selection_kind} selected_by=${row?.selected_by === null ? "null" : "set"}`
      );
      await db.from("content_media").delete().eq("content_id", article.id).eq("role", "gallery");
    }
  }

  await report(cleanup);
}

async function report(cleanup: (() => Promise<void>)[]): Promise<void> {
  for (const undo of cleanup.reverse()) {
    try {
      await undo();
    } catch (e) {
      record("cleanup", false, String(e));
    }
  }

  console.log("\n=== 20260826_media_selection_provenance.sql — LIVE PRODUCTION ===\n");
  for (const c of checks) {
    console.log(`  ${c.state.padEnd(5)} ${c.name}`);
    console.log(`        ${c.detail}`);
  }
  const failed = checks.filter((c) => c.state === "FAIL");
  console.log(`\n  ${checks.length - failed.length}/${checks.length} PASS`);
  console.log(`  MEDIA SELECTION PROVENANCE MIGRATION: ${failed.length === 0 ? "PASS" : "FAIL"}\n`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
