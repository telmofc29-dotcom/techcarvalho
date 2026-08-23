"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { SOURCE_LOCALE, isLocale, type Locale } from "@/lib/i18n/locales";
import type { CreateTranslationResult } from "./types";

// Create the translation row for one (source article, target locale) pair.
//
// requireAdmin() IS MANDATORY HERE
// --------------------------------
// A Server Action is invoked directly by the client — it does not pass through
// the admin layout, so layout-level protection is not protection at all for
// this function. RLS underneath would still reject a non-admin insert, but the
// caller would get a raw Postgres error instead of a redirect, and relying on
// that means the check exists in exactly one place. See CLAUDE.md.
//
// WHAT THIS DELIBERATELY DOES NOT DO
// ----------------------------------
// It does not copy, restate or alter a single factual thing. Product names,
// model numbers, manufacturers, specs, source_records, media rights and
// provenance are SHARED and untranslated — they live on tables this action
// never touches, and they resolve through translation_group_id at query time.
// 20260824_translation_model.sql's whole argument is that there must be no
// per-locale column for a product name, so that a translator cannot translate
// one even by trying; this action must not smuggle one in by copying rows.
//
// It also never sets status = 'published'. A translation reaches the public
// site through the normal editorial workflow (and, for the public routes, a
// separate workstream) — not as a side effect of being created.

export async function createTranslation(formData: FormData): Promise<CreateTranslationResult> {
  // First line of the function, before anything reads the form.
  await requireAdmin();

  const sourceId = String(formData.get("source_id") ?? "").trim();
  const localeInput = String(formData.get("locale") ?? "").trim();

  if (!sourceId) return { ok: false, error: "No source article was named." };
  if (!isLocale(localeInput)) {
    return { ok: false, error: `"${localeInput}" is not a locale this site publishes in.` };
  }
  const locale = localeInput as Locale;
  if (locale === SOURCE_LOCALE) {
    return {
      ok: false,
      error: `${SOURCE_LOCALE} is the source language. An article cannot be a translation of itself.`,
    };
  }

  const supabase = await createClient();

  // The locale must exist as a row, not merely as a TypeScript union. The
  // FK would reject an unknown code anyway, but a named error beats 23503.
  const { data: localeRow, error: localeError } = await supabase
    .from("locales")
    .select("code, label, is_source")
    .eq("code", locale)
    .maybeSingle();
  if (localeError) {
    return { ok: false, error: `Could not read the locale list — ${localeError.message}` };
  }
  if (!localeRow) {
    return { ok: false, error: `Locale "${locale}" is not in public.locales.` };
  }
  if (localeRow.is_source) {
    return { ok: false, error: `Locale "${locale}" is the source language in public.locales.` };
  }

  const { data: source, error: sourceError } = await supabase
    .from("content_items")
    .select("id, type, title, slug, status, locale, category_id, search_intent, translation_group_id, translatable_revision")
    .eq("id", sourceId)
    .maybeSingle();
  if (sourceError) {
    return { ok: false, error: `Could not read the source article — ${sourceError.message}` };
  }
  if (!source) {
    return { ok: false, error: "That source article no longer exists." };
  }
  // content_items_translation_shape requires locale = 'en' for any row with a
  // null source_content_id; translating a translation would build a chain whose
  // staleness cannot be reasoned about. Checked here so the message is readable.
  if (source.locale !== SOURCE_LOCALE) {
    return {
      ok: false,
      error: `That article is itself a ${source.locale} translation. Translations are made from the ${SOURCE_LOCALE} source only.`,
    };
  }

  // One row per (family, locale). Checked before inserting so a double-click
  // gets a plain sentence rather than a unique-violation on (locale, slug).
  const { data: existing, error: existingError } = await supabase
    .from("content_items")
    .select("id")
    .eq("translation_group_id", source.translation_group_id)
    .eq("locale", locale)
    .maybeSingle();
  if (existingError) {
    return { ok: false, error: `Could not check for an existing translation — ${existingError.message}` };
  }
  if (existing) {
    return { ok: false, error: `A ${localeRow.label} version of this article already exists.` };
  }

  const { data: created, error: insertError } = await supabase
    .from("content_items")
    .insert({
      // --- locale identity ---
      locale,
      // Set EXPLICITLY rather than left to a default. The BEFORE INSERT trigger
      // that would infer it is in supabase/migrations_pending/
      // 20260825_translation_group_default.sql and is NOT applied, so an omitted
      // value fails with 23502 today. Naming the source's family here is also
      // just correct: that is what makes this row a translation OF that article
      // rather than the root of a new family, and it keeps working unchanged
      // once the migration lands.
      translation_group_id: source.translation_group_id,
      source_content_id: source.id,
      // The revision this translation is being made from. Everything the
      // staleness rule does depends on this being right at creation time.
      source_revision_seen: source.translatable_revision ?? 1,
      translation_state: "draft",
      // NOT 'published', and not the source's status either. A translation
      // starts as a draft and is published by the editorial workflow.
      status: "draft",
      published_at: null,
      // Not translated yet — nothing has been written. Stamping a time here
      // would assert work that has not happened.
      translated_at: null,

      // --- structure, shared with the source (not prose, not translated) ---
      type: source.type,
      // The same slug is legal in another locale: 20260824_translation_model.sql
      // replaced the global unique slug with a unique index on (locale, slug).
      slug: source.slug,
      category_id: source.category_id,
      search_intent: source.search_intent,

      // --- prose ---
      // The title is seeded from the source ONLY because the column is NOT NULL
      // and there is no honest placeholder; it is the first thing the translator
      // replaces and the one field they cannot miss.
      title: source.title,
      // The body is deliberately left empty rather than seeded with the English
      // text. Copying it would put untranslated English one status-flip away
      // from appearing under a /pt/ URL — precisely Google's documented
      // condition for treating localised pages as duplicates, and dishonest
      // besides. An empty body cannot be published as English-under-/pt/; a
      // copied one can, and would rely on somebody remembering not to.
      body: null,

      // primary_query and intent_fingerprint are NOT copied. The fingerprint
      // especially: 20260824_translation_model.sql's CANNIBALISATION section
      // warns that a translation carrying its source's intent_fingerprint trips
      // the duplicate-intent rule against its OWN English original, and the
      // locale-scoping fix for those call sites is explicitly still to do. A
      // search query is per-language anyway.
      primary_query: null,
      intent_fingerprint: null,

      // author_id is deliberately left unset. The admin who pressed "start" has
      // not written anything; naming them as the author of a row with no body
      // would be a byline for prose that does not exist. Whoever translates it
      // is recorded through the normal editorial workflow.
    })
    .select("id")
    .single();

  if (insertError) {
    // 23502 is the known live defect: translation_group_id NOT NULL with no
    // default. It should be unreachable because the value is set above, so if
    // it fires, something else is missing a value — say so rather than blaming
    // the known bug.
    if (insertError.code === "23502") {
      return {
        ok: false,
        error: `The insert was rejected for a missing required value (23502) — ${insertError.message}. supabase/migrations_pending/20260825_translation_group_default.sql is still unapplied; this action sets translation_group_id itself, so a different column is at fault.`,
      };
    }
    return { ok: false, error: `Could not create the translation — ${insertError.message}` };
  }
  if (!created) {
    // An insert that reports no error and returns no row is the silent-success
    // shape. Never report it as a success.
    return { ok: false, error: "The insert reported success but returned no row. Nothing was confirmed created." };
  }

  revalidatePath("/admin/translations");
  revalidatePath("/admin/content");
  return { ok: true, id: created.id };
}

/**
 * useActionState() adapter. Same action, (previousState, formData) shape.
 *
 * Deliberately a thin wrapper rather than a second implementation — there is
 * exactly one createTranslation(), and it is the one that calls requireAdmin().
 */
export async function createTranslationFormAction(
  _previous: CreateTranslationResult | null,
  formData: FormData
): Promise<CreateTranslationResult | null> {
  return createTranslation(formData);
}
