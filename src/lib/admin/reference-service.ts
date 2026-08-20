import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TableName, Row, Insert, Update } from "@/lib/types/database";

// Explicit named union so `"error" in result` narrows cleanly. TypeScript's
// control-flow narrowing on structurally-inferred (unannotated) union
// return types doesn't always exclude the non-matching branch's absent
// property, which leaves `result.error` typed as `string | undefined`
// instead of `string`. A named type sidesteps that.
export type ValidationResult<Payload> = { error: string } | { payload: Payload };

// Thin, generic wrappers around the Supabase client for simple single-table
// CRUD. Every table here has RLS requiring public.is_admin() for writes, and
// every caller must have already gone through requireAdmin() at the action
// or page boundary — these helpers do not re-check authorization themselves.

export async function listRows<T extends TableName>(
  table: T,
  opts: { orderBy?: string; ascending?: boolean; select?: string } = {}
): Promise<Row<T>[]> {
  const supabase = await createClient();
  let query = supabase.from(table).select(opts.select ?? "*");
  if (opts.orderBy) {
    query = query.order(opts.orderBy, { ascending: opts.ascending ?? true });
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Row<T>[];
}

export type PaginatedRows<T extends TableName> = { rows: Row<T>[]; total: number; pageCount: number; page: number };

export async function listRowsPaginated<T extends TableName>(
  table: T,
  opts: { orderBy?: string; ascending?: boolean; page: number; pageSize: number }
): Promise<PaginatedRows<T>> {
  const supabase = await createClient();
  const page = Math.max(1, opts.page);
  const from = (page - 1) * opts.pageSize;
  const to = from + opts.pageSize - 1;

  let query = supabase.from(table).select("*", { count: "exact" }).range(from, to);
  if (opts.orderBy) {
    query = query.order(opts.orderBy, { ascending: opts.ascending ?? true });
  }
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  const total = count ?? 0;
  return {
    rows: (data ?? []) as unknown as Row<T>[],
    total,
    pageCount: Math.max(1, Math.ceil(total / opts.pageSize)),
    page,
  };
}

export async function getRowById<T extends TableName>(table: T, id: string): Promise<Row<T> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(table)
    .select("*")
    // @ts-expect-error -- every table's primary key column is "id", but that isn't expressed generically here
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as unknown as Row<T> | null;
}

export async function insertRow<T extends TableName>(
  table: T,
  payload: Insert<T>
): Promise<Row<T>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(table)
    // @ts-expect-error -- generic Insert<T> is not narrowed per-table here
    .insert(payload)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as Row<T>;
}

export async function updateRow<T extends TableName>(
  table: T,
  id: string,
  payload: Update<T>
): Promise<Row<T>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(table)
    // @ts-expect-error -- generic Update<T> is not narrowed per-table here
    .update(payload)
    // @ts-expect-error -- every table's primary key column is "id", but that isn't expressed generically here
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as Row<T>;
}

export async function deleteRow<T extends TableName>(table: T, id: string): Promise<void> {
  const supabase = await createClient();
  // @ts-expect-error -- every table's primary key column is "id", but that isn't expressed generically here
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw new Error(error.message);
}
