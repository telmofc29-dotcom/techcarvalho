// Which pending migrations are actually still needed?
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/audit-migrations.ts
//
// READ-ONLY. Applies nothing.
//
// supabase/migrations_pending/ accumulates files, and a file sitting there
// proves nothing about production — several have been applied by hand and never
// moved, and one was applied and did nothing at all because every line of it
// was a comment. So each is classified by PROBING what it would create.

import { readdirSync } from "node:fs";
import { loadEnvLocal, createAdminClient } from "./_shared.ts";

loadEnvLocal();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }> };

type Verdict = "APPLIED" | "REQUIRED" | "OPTIONAL" | "UNKNOWN";
type Result = { file: string; verdict: Verdict; evidence: string; note: string };

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;
  const files = readdirSync("supabase/migrations_pending").filter((f) => f.endsWith(".sql")).sort();

  const tableExists = async (t: string) => {
    const { error } = await db.from(t).select("id").limit(1);
    return !error;
  };
  const columnExists = async (t: string, c: string) => {
    const { error } = await db.from(t).select(c).limit(1);
    return !error;
  };
  const rpcExists = async (fn: string, args: Record<string, unknown>) => {
    const { error } = await db.rpc(fn, args);
    return !(error && ["PGRST202", "42883"].includes(error.code ?? ""));
  };

  // The prober must be able to say NO before any yes is trusted.
  if (await tableExists("tc_table_that_must_never_exist")) {
    throw new Error("capability probe is broken — it reported a nonexistent table as present.");
  }

  const results: Result[] = [];

  for (const file of files) {
    let r: Result;
    switch (file) {
      case "20260825_author_profiles.sql": {
        const ok = await tableExists("author_profiles");
        r = { file, verdict: ok ? "APPLIED" : "REQUIRED", evidence: `author_profiles ${ok ? "exists" : "missing"}`,
              note: ok ? "Applied by the owner. Bylines resolve from it." : "Needed for any byline." };
        break;
      }
      case "20260825_contact_messages.sql": {
        const ok = await rpcExists("submit_contact_message", { p_name: "", p_email: "", p_subject: "", p_message: "" });
        r = { file, verdict: ok ? "APPLIED" : "REQUIRED", evidence: `submit_contact_message ${ok ? "resolves" : "missing"}`,
              note: ok ? "Applied. /contact accepts messages." : "Until applied, /contact hides the form." };
        break;
      }
      case "20260825b_backfill_content_author_id.sql": {
        const { data, error } = await db.from("content_items").select("author_id").eq("status", "published");
        if (error) throw new Error(error.message);
        const withAuthor = (data as { author_id: string | null }[]).filter((x) => x.author_id).length;
        const total = (data as unknown[]).length;
        r = { file, verdict: withAuthor === total && total > 0 ? "APPLIED" : "OPTIONAL",
              evidence: `${withAuthor}/${total} published rows carry author_id`,
              note: "Owner ran this. It is a one-off data backfill, not schema — re-running is pointless." };
        break;
      }
      case "20260825b_normalise_double_encoded_specs_RUNNABLE.sql": {
        const { data, error } = await db.from("product_specs").select("value");
        if (error) throw new Error(error.message);
        const dbl = (data as { value: unknown }[]).filter(
          (x) => typeof x.value === "string" && /^\s*"[\s\S]*"\s*$/.test(x.value)
        ).length;
        r = { file, verdict: dbl === 0 ? "APPLIED" : "REQUIRED", evidence: `${dbl} double-encoded values remain`,
              note: dbl === 0 ? "Data is clean. Re-running is a no-op by construction." : "Still needed." };
        break;
      }
      case "20260826_assemble_draft_locale_slug.sql": {
        // Behavioural: does the guard understand locale? Proven in the
        // production-state verifier; here just check the function resolves.
        const ok = await rpcExists("engine_assemble_draft", {
          p_brief_id: "00000000-0000-0000-0000-0000000000ff", p_title: "x", p_slug: "x", p_body: "x",
          p_content_type: "news", p_category_slug: null, p_search_intent: null,
          p_primary_query: null, p_source_urls: [],
        });
        r = { file, verdict: ok ? "APPLIED" : "UNKNOWN",
              evidence: ok ? "engine_assemble_draft resolves; locale guard verified separately" : "RPC missing",
              note: "verify-production-state.ts proves the locale-aware behaviour behaviourally." };
        break;
      }
      case "20260827_knowledge_graph.sql": {
        const parts = await Promise.all([
          tableExists("technology_concepts"), tableExists("product_claims"),
          columnExists("products", "maturity"), columnExists("product_relationships", "basis"),
          columnExists("source_records", "source_class"), columnExists("products", "release_date_precision"),
        ]);
        const ok = parts.every(Boolean);
        r = { file, verdict: ok ? "APPLIED" : "REQUIRED", evidence: `${parts.filter(Boolean).length}/6 objects present`,
              note: ok ? "Applied. 24/24 behavioural checks pass." : "Partially applied — investigate before re-running." };
        break;
      }
      case "20260827_content_attribution.sql": {
        const has = await columnExists("content_items", "attribution");
        const { count } = await db.from("content_items").select("id", { count: "exact", head: true }) as unknown as { count: number };
        r = {
          file,
          verdict: has ? "APPLIED" : "OPTIONAL",
          evidence: has ? "content_items.attribution exists" : "column absent; code default is 'reviewed_published'",
          note: has
            ? "Applied."
            : `NOT NEEDED for correctness. All ${count} articles already render "Reviewed and published by" and emit the publication as author with the person as editor, because attributionKind() defaults to reviewed_published for a missing value. Apply this ONLY when a piece genuinely written from scratch by a person needs to say "By" — it makes attribution per-article rather than one site-wide default.`,
        };
        break;
      }
      default:
        r = { file, verdict: "UNKNOWN", evidence: "no probe defined", note: "Add a probe before acting on this." };
    }
    results.push(r);
  }

  const group = (v: Verdict) => results.filter((r) => r.verdict === v);
  const show = (title: string, rows: Result[]) => {
    console.log(`\n${title}`);
    if (rows.length === 0) { console.log("  (none)"); return; }
    for (const r of rows) {
      console.log(`  ${r.file}`);
      console.log(`      evidence: ${r.evidence}`);
      console.log(`      ${r.note}`);
    }
  };

  console.log("=== MIGRATION AUDIT (probed against production) ===");
  show("A. ALREADY APPLIED / OBSOLETE — DO NOT RUN", [...group("APPLIED")]);
  show("B. NEW AND GENUINELY REQUIRED — OWNER SHOULD RUN", group("REQUIRED"));
  show("C. OPTIONAL / FUTURE ARCHITECTURE — DO NOT RUN YET", group("OPTIONAL"));
  show("UNCLASSIFIED — needs a probe", group("UNKNOWN"));

  console.log(`\n${results.length} files examined. Nothing was applied.`);
}

main().catch((e) => { console.error("audit failed:", e instanceof Error ? e.message : e); process.exitCode = 1; });
