import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";

// Guards the spotlight migration against the class of bug that made it fail to
// apply: a PostgreSQL keyword used as an identifier.
//
// `position` is a col_name_keyword — the SQL-standard position(substring IN
// string) function. CREATE TABLE tolerates it, so the column definition parsed
// happily; a RETURNS TABLE list does not, and the migration died at 42601 on a
// line 125 further down than the one that introduced the name.
//
// That asymmetry is what makes it worth a test rather than a memory: the
// mistake is invisible at the point you make it.

/** col_name_keywords with function-call syntax, plus fully reserved words. */
const HAZARDOUS_IDENTIFIERS = new Set([
  "between", "bigint", "bit", "boolean", "char", "character", "coalesce", "collation",
  "dec", "decimal", "exists", "extract", "float", "greatest", "grouping", "inout", "int",
  "integer", "interval", "least", "national", "nchar", "none", "normalize", "nullif",
  "numeric", "out", "overlay", "position", "precision", "real", "row", "setof", "smallint",
  "substring", "time", "timestamp", "treat", "trim", "values", "varchar", "xmltable",
  "all", "and", "any", "array", "as", "asc", "both", "case", "cast", "check", "collate",
  "column", "constraint", "create", "default", "desc", "distinct", "do", "else", "end",
  "except", "false", "for", "foreign", "from", "grant", "group", "having", "in", "into",
  "limit", "not", "null", "offset", "on", "only", "or", "order", "primary", "references",
  "returning", "select", "some", "table", "then", "to", "true", "union", "unique", "user",
  "using", "when", "where", "window", "with",
]);

function migrationSql(basename: string): string {
  for (const dir of ["supabase/migrations_pending", "supabase/migrations"]) {
    if (!existsSync(dir)) continue;
    const hit = readdirSync(dir).find((f) => f === basename);
    if (hit) return readFileSync(`${dir}/${hit}`, "utf8");
  }
  throw new Error(`${basename} not found in migrations or migrations_pending`);
}

function identifiersIn(sql: string): { where: string; name: string }[] {
  const found: { where: string; name: string }[] = [];

  for (const m of sql.matchAll(/create table if not exists ([\w.]+) \(([\s\S]*?)\n\);/g)) {
    for (const raw of m[2].split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("--") || line.startsWith("constraint")) continue;
      found.push({ where: `create table ${m[1]}`, name: line.split(/\s+/)[0].replace(/,$/, "") });
    }
  }
  for (const m of sql.matchAll(/returns table \(([\s\S]*?)\)\s*\nlanguage/g)) {
    for (const raw of m[1].split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("--")) continue;
      found.push({ where: "returns table", name: line.split(/\s+/)[0].replace(/,$/, "") });
    }
  }
  for (const m of sql.matchAll(/create or replace function ([\w.]+)\(([\s\S]*?)\)\s*\nreturns/g)) {
    for (const raw of m[2].split(",")) {
      const part = raw.trim();
      if (!part || part.startsWith("--")) continue;
      found.push({ where: `function ${m[1]}`, name: part.split(/\s+/)[0] });
    }
  }
  return found;
}

test("the spotlight migration uses no PostgreSQL keyword as an identifier", () => {
  const sql = migrationSql("20260824_spotlight_rotation.sql");
  const offenders = identifiersIn(sql).filter((i) =>
    HAZARDOUS_IDENTIFIERS.has(i.name.toLowerCase())
  );
  assert.deepEqual(
    offenders,
    [],
    `keyword used as an identifier: ${offenders.map((o) => `${o.name} in ${o.where}`).join(", ")}`
  );
});

test("the spotlight migration settled on slot_position, everywhere", () => {
  const sql = migrationSql("20260824_spotlight_rotation.sql");
  assert.ok(sql.includes("slot_position integer not null"), "the column must be slot_position");
  assert.ok(sql.includes("p_slot_position"), "the parameter must be p_slot_position");
  assert.ok(sql.includes("l.slot_position"), "the select must read slot_position");

  // No bare `position` left as an IDENTIFIER. Comments and SQL string literals
  // are prose -- `comment on table ... 'front-page position on which day'` is
  // correct English and must not fail this -- so both are stripped first.
  const code = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .replace(/'(?:[^']|'')*'/g, "''");
  assert.ok(
    !/(?<![\w.])position(?!\w)/.test(code.replace(/slot_position/g, "")),
    "a bare `position` identifier survives outside comments and string literals"
  );
});

test("the applied override-window view is what selection reads", () => {
  // The windows migration is applied but selection read the BASE table, so a
  // window was recorded and then ignored. The repoint is the whole reason this
  // function is re-created here.
  const sql = migrationSql("20260824_spotlight_rotation.sql");
  const fn = sql.slice(sql.indexOf("create or replace function public.public_homepage_selection"));
  assert.ok(
    fn.includes("public.homepage_overrides_active"),
    "public_homepage_selection must read homepage_overrides_active"
  );
  assert.ok(
    !/ov as \(select o\.content_id, o\.mode from public\.homepage_overrides o\)/.test(fn),
    "it must no longer read the base homepage_overrides table"
  );
});

test("the migration's self-check can actually fail", () => {
  // NOT `assert`. plpgsql compiles ASSERT out when plpgsql.check_asserts is
  // off, so a migration that verifies itself with ASSERT can be applied with
  // its verification silently skipped -- which is the same class of bug as an
  // empty result that looks like a working one. It must raise.
  const sql = migrationSql("20260824_spotlight_rotation.sql");
  const block = sql.slice(sql.indexOf("do $verify$"));
  assert.ok(block.length > 0, "must carry a self-check block");
  assert.ok(/raise exception/i.test(block), "the self-check must raise, not ASSERT");
  assert.ok(
    /homepage_overrides_active/.test(block),
    "the self-check must confirm the prerequisite view exists"
  );
  assert.ok(
    /v_count = 0/.test(block),
    "the self-check must fail when selection returns nothing, not merely count >= 0"
  );
});
