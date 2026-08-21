// Shared helpers for the catalogue/content ingestion scripts. Not part of
// the Next.js app — standalone Node scripts run via `npx tsx scripts/...`.
// No service-role key anywhere: both ingestion scripts authenticate as a
// real admin user (via signInWithPassword, same RLS path the web app uses)
// rather than bypassing RLS.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/types/database";

// Minimal .env.local loader — only sets a var if it isn't already present
// in the environment, so a real shell/CI env var always wins. Avoids
// depending on tsx/node flag passthrough behaviour for --env-file.
export function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf-8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

export type CliArgs = {
  apply: boolean;
  files: string[];
};

export function parseArgs(argv: string[]): CliArgs {
  const apply = argv.includes("--apply");
  const files = argv.filter((a) => !a.startsWith("--"));
  return { apply, files };
}

// Root-cause fix for the 2026-08-20 incident: a production catalogue
// --apply created 16 products but 0 spec_definitions, because
// data/catalogue/_spec-definitions.ts wasn't in the invoker's file list.
// Confirmed by direct test: unlike bash, PowerShell does NOT glob-expand a
// bare wildcard argument passed to a native executable — `node script.mjs
// data/catalogue/*.ts` in PowerShell delivers the literal, unexpanded
// string "data/catalogue/*.ts" to process.argv. Since this project's
// primary shell is PowerShell, relying on the caller's shell to expand a
// glob (or on a human to remember every underscore-prefixed "definition"
// file by name) is not safe. This function does the expansion in Node
// itself, shell-independently, and — regardless of whether any wildcard
// was used at all — always sweeps in every `_*.ts` file from each
// referenced directory, since those are always-required base data
// (spec_definitions, taxonomy_tags) that every batch in that directory
// depends on, not optional extras a caller opts into.
export function resolveDataFiles(explicitArgs: string[]): string[] {
  // Every path goes into these sets as an absolute, separator-normalized
  // form (via path.resolve) before being deduped — a bash-style forward-
  // slash argument ("data/catalogue/_spec-definitions.ts") and a
  // path.join-constructed backslash path ("data\catalogue\_spec-
  // definitions.ts") refer to the same file on Windows but are different
  // strings, and a plain Set would treat them as two entries, silently
  // double-loading (and double-counting) that file's contents.
  const resolved = new Set<string>();
  const dirsSeen = new Set<string>();

  const globToRegExp = (pattern: string): RegExp =>
    new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);

  for (const arg of explicitArgs) {
    const dir = dirname(arg);
    dirsSeen.add(resolve(dir));
    if (!arg.includes("*")) {
      resolved.add(resolve(arg));
      continue;
    }
    // The shell didn't expand this wildcard (or expanded it into a single
    // literal argument some other way) — expand it ourselves.
    const pattern = globToRegExp(basename(arg));
    for (const name of readdirSync(dir)) {
      if (pattern.test(name)) resolved.add(resolve(join(dir, name)));
    }
  }

  for (const dir of dirsSeen) {
    for (const name of readdirSync(dir)) {
      if (name.startsWith("_") && name.endsWith(".ts")) resolved.add(resolve(join(dir, name)));
    }
  }

  return [...resolved];
}

export type IngestClient = SupabaseClient<Database>;

// Unauthenticated (anon-role) client — sufficient for --dry-run, since
// dry-run only ever reads world-readable reference data (taxonomy
// categories, and whatever's already published) plus whatever this batch
// itself declares. It will under-detect duplicates among unpublished
// admin-only rows; see the printed dry-run caveat.
export function createAnonClient(): IngestClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set (.env.local missing?).");
  }
  return createClient<Database>(url, key);
}

// Authenticated admin client for --apply. Requires TC_ADMIN_EMAIL /
// TC_ADMIN_PASSWORD — new env vars, never committed, never hardcoded.
// Fails loudly (not silently) if credentials are missing or sign-in fails,
// since a script that silently fell back to anon and then hit RLS denials
// row-by-row would be far more confusing to debug.
export async function createAdminClient(): Promise<IngestClient> {
  const client = createAnonClient();
  const email = process.env.TC_ADMIN_EMAIL;
  const password = process.env.TC_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "--apply requires TC_ADMIN_EMAIL and TC_ADMIN_PASSWORD to be set in the environment (not .env.local — " +
        "set them for this invocation only, e.g. `TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/... --apply`). " +
        "No admin account exists yet in this environment as of this batch — see docs/content-launch-plan.md."
    );
  }
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Admin sign-in failed: ${error.message}`);
  return client;
}

export type PlanAction = "create" | "update" | "skip" | "error";

export type PlanEntry = {
  entity: string;
  identifier: string;
  action: PlanAction;
  detail?: string;
};

export class IngestPlan {
  entries: PlanEntry[] = [];
  hardErrors: string[] = [];

  record(entry: PlanEntry): void {
    this.entries.push(entry);
    if (entry.action === "error" && entry.detail) this.hardErrors.push(`${entry.entity} ${entry.identifier}: ${entry.detail}`);
  }

  summaryByEntity(): Map<string, Record<PlanAction, number>> {
    const map = new Map<string, Record<PlanAction, number>>();
    for (const e of this.entries) {
      const counts = map.get(e.entity) ?? { create: 0, update: 0, skip: 0, error: 0 };
      counts[e.action]++;
      map.set(e.entity, counts);
    }
    return map;
  }

  print(mode: "dry-run" | "apply"): void {
    console.log(`\n=== ${mode === "dry-run" ? "DRY RUN — nothing was written" : "APPLY — changes were written"} ===\n`);
    const summary = this.summaryByEntity();
    console.log("entity".padEnd(24) + "create".padStart(8) + "update".padStart(8) + "skip".padStart(8) + "error".padStart(8));
    for (const [entity, counts] of summary) {
      console.log(
        entity.padEnd(24) +
          String(counts.create).padStart(8) +
          String(counts.update).padStart(8) +
          String(counts.skip).padStart(8) +
          String(counts.error).padStart(8)
      );
    }
    if (this.hardErrors.length > 0) {
      console.log(`\n${this.hardErrors.length} error(s):`);
      for (const e of this.hardErrors) console.log(`  - ${e}`);
    }
    console.log("");
  }

  get hasErrors(): boolean {
    return this.hardErrors.length > 0;
  }
}

export type SlugTable = "manufacturers" | "spec_definitions" | "product_families" | "taxonomy_tags";

// Generic upsert-by-slug: looks up existing rows by slug, creates missing
// ones, updates ones that already exist, and returns a slug->id map for
// resolving cross-references. Shared by both ingestion scripts for every
// simple reference table they can also define new rows for in the same
// batch (manufacturers/spec_definitions/product_families for the catalogue
// script; taxonomy_tags for the content script) — NOT used for
// taxonomy_categories, which both scripts treat as read-only/pre-existing
// (see 001_initial_taxonomy_categories.sql; creating categories is a
// deliberate editorial decision, not something an import batch should do
// implicitly).
export async function upsertBySlug<Row extends { slug: string }>(
  client: IngestClient,
  table: SlugTable,
  entityLabel: string,
  items: Row[],
  toRow: (item: Row) => Record<string, unknown>,
  plan: IngestPlan,
  apply: boolean
): Promise<{ [slug: string]: string }> {
  const slugToId: { [slug: string]: string } = {};
  if (items.length === 0) return slugToId;

  const { data: existing, error: existingErr } = await client
    .from(table)
    .select("id, slug")
    .in("slug", items.map((i) => i.slug));
  if (existingErr) throw new Error(`Failed to look up existing ${table}: ${existingErr.message}`);
  const existingBySlug = new Map((existing ?? []).map((r) => [r.slug, r.id]));

  for (const item of items) {
    const existingId = existingBySlug.get(item.slug);
    const action = existingId ? "update" : "create";

    if (!apply) {
      plan.record({ entity: entityLabel, identifier: item.slug, action });
      if (existingId) slugToId[item.slug] = existingId;
      continue;
    }

    const row = toRow(item);
    if (existingId) {
      const { error } = await client.from(table).update(row as never).eq("id", existingId);
      if (error) {
        plan.record({ entity: entityLabel, identifier: item.slug, action: "error", detail: error.message });
        continue;
      }
      slugToId[item.slug] = existingId;
      plan.record({ entity: entityLabel, identifier: item.slug, action: "update" });
    } else {
      const { data, error } = await client.from(table).insert(row as never).select("id").single();
      if (error || !data) {
        plan.record({ entity: entityLabel, identifier: item.slug, action: "error", detail: error?.message ?? "insert failed" });
        continue;
      }
      slugToId[item.slug] = data.id;
      plan.record({ entity: entityLabel, identifier: item.slug, action: "create" });
    }
  }

  return slugToId;
}

// Loads each data file's batch object via dynamic import (tsx handles
// on-the-fly TS compilation for these at runtime). Accepts either
// `export default {...}` or a single named export (e.g.
// `export const canonEos5d: CatalogueImport = {...}`) — both conventions
// exist in practice across the real data files this consumes, so this
// stays permissive rather than forcing every file onto one exact shape.
// If a file has neither a default export nor exactly one named export,
// that's ambiguous and a hard error (which export is the batch object?).
export async function loadImportFiles<T>(files: string[]): Promise<T[]> {
  const results: T[] = [];
  for (const file of files) {
    const abs = resolve(process.cwd(), file);
    // Dynamic import() requires a proper file:// URL on Windows — a bare
    // absolute path like "C:\..." is rejected by the ESM loader.
    const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
    if (mod.default !== undefined) {
      results.push(mod.default as T);
      continue;
    }
    const namedExports = Object.entries(mod).filter(([key]) => key !== "__esModule");
    if (namedExports.length === 1) {
      results.push(namedExports[0][1] as T);
      continue;
    }
    throw new Error(
      `${file} has no default export and ${namedExports.length} named exports (expected exactly 1) — ` +
        `every catalogue/content data file must export exactly one batch object, either as \`export default\` ` +
        `or a single \`export const\`.`
    );
  }
  return results;
}
