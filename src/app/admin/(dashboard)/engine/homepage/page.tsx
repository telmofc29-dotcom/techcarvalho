import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader,
  Card,
  Badge,
  Field,
  TextInput,
  Select,
  TextLink,
  EmptyState,
  QueryErrorBanner,
} from "@/components/admin/ui";
import { SubmitButton } from "@/components/admin/submit-button";
import { setHomepageOverride, removeHomepageOverride } from "../actions";
import { EngineTabs, formatDateTime } from "../shared";

// Homepage trending control.
//
// The ranking itself is deterministic and lives in the public data layer; this
// page is the manual escape hatch on top of it. Three modes, all narrow:
// pin_lead forces one item into the hero slot, pin_supporting forces one into
// the supporting row, suppress removes one entirely.
//
// An override cannot publish anything. The public homepage still filters to
// status='published', so pinning an unpublished item changes nothing a visitor
// can see — the override reorders published content, it does not promote
// content into being published.

type PublishedRow = {
  id: string;
  title: string;
  slug: string;
  type: string;
  published_at: string | null;
  category_id: string | null;
};

type OverrideRow = {
  id: string;
  content_id: string;
  mode: string;
  note: string | null;
  created_at: string;
};

const MODE_LABEL: Record<string, string> = {
  pin_lead: "Pinned as lead",
  pin_supporting: "Pinned as supporting",
  suppress: "Suppressed",
};

const MODE_TONE: Record<string, "green" | "blue" | "red"> = {
  pin_lead: "green",
  pin_supporting: "blue",
  suppress: "red",
};

export default async function EngineHomepagePage() {
  await requireAdmin();
  const supabase = await createClient();

  const nowIso = new Date().toISOString();

  const [
    { data: published, error: publishedError },
    { data: overrides, error: overridesError },
    { data: categories, error: categoriesError },
  ] = await Promise.all([
    supabase
      .from("content_items")
      .select("id, title, slug, type, published_at, category_id")
      .eq("status", "published")
      .lte("published_at", nowIso)
      .order("published_at", { ascending: false })
      .limit(40),
    supabase.from("homepage_overrides").select("id, content_id, mode, note, created_at"),
    supabase.from("taxonomy_categories").select("id, name"),
  ]);

  const rows = (published ?? []) as unknown as PublishedRow[];
  const overrideRows = (overrides ?? []) as unknown as OverrideRow[];
  const categoryNameById = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const titleById = new Map(rows.map((r) => [r.id, r.title]));

  const overrideByContentId = new Map(overrideRows.map((o) => [o.content_id, o]));

  // Interim preview. The deterministic ranking used by the live homepage lives
  // in the public data layer (src/lib/public/trending.ts); until that exists
  // this page previews recency order, which is also the documented fallback
  // when there is no engagement data — so the two agree in the low-data case
  // the site is currently in.
  const suppressed = new Set(
    overrideRows.filter((o) => o.mode === "suppress").map((o) => o.content_id)
  );
  const eligible = rows.filter((r) => !suppressed.has(r.id));

  const pinnedLeadId = overrideRows.find((o) => o.mode === "pin_lead")?.content_id ?? null;
  const pinnedSupportingIds = overrideRows
    .filter((o) => o.mode === "pin_supporting")
    .map((o) => o.content_id);

  const lead =
    (pinnedLeadId ? eligible.find((r) => r.id === pinnedLeadId) : undefined) ?? eligible[0] ?? null;

  const supporting = [
    ...eligible.filter((r) => pinnedSupportingIds.includes(r.id) && r.id !== lead?.id),
    ...eligible.filter(
      (r) => !pinnedSupportingIds.includes(r.id) && r.id !== lead?.id
    ),
  ].slice(0, 5);

  const anyError = publishedError || overridesError || categoriesError;
  const usingFallback = pinnedLeadId === null;

  return (
    <div>
      <PageHeader
        title="Homepage"
        description="What the public homepage would currently feature, and the manual pins that override it."
      />
      <EngineTabs current="/admin/engine/homepage" />

      <Card className="p-4 mb-6 border-blue-200 bg-blue-50">
        <p className="text-sm font-medium text-neutral-900">What an override can and cannot do</p>
        <p className="text-xs text-neutral-700 mt-1">
          Overrides reorder <strong>already-published</strong> content. They cannot publish anything: the homepage
          query filters to published items regardless, so pinning a draft or an awaiting-media record has no visible
          effect. Use <strong>suppress</strong> to keep something out of the trending block without unpublishing it.
        </p>
      </Card>

      {publishedError && <QueryErrorBanner message={`Failed to load published content: ${publishedError.message}`} />}
      {overridesError && <QueryErrorBanner message={`Failed to load homepage overrides: ${overridesError.message}`} />}
      {categoriesError && <QueryErrorBanner message={`Failed to load categories: ${categoriesError.message}`} />}

      {!anyError && (
        <>
          <section className="mb-8">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="text-sm font-semibold text-neutral-900">Current lead</h2>
              {usingFallback ? (
                <Badge tone="neutral">Automatic (most recent)</Badge>
              ) : (
                <Badge tone="green">Pinned</Badge>
              )}
            </div>
            <p className="text-xs text-neutral-500 mb-3">
              {usingFallback
                ? "No lead is pinned, so the most recently published eligible item leads."
                : "An administrator has pinned this item as the lead."}
            </p>
            {lead ? (
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900">
                      <TextLink href={`/admin/content/${lead.id}`}>{lead.title}</TextLink>
                    </p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {lead.category_id ? (categoryNameById.get(lead.category_id) ?? "—") : "no category"} ·{" "}
                      {lead.type} · published {formatDateTime(lead.published_at)}
                    </p>
                  </div>
                  <TextLink href={`/articles/${lead.slug}`}>View live</TextLink>
                </div>
              </Card>
            ) : (
              <EmptyState
                title="Nothing eligible to lead"
                description="No published content is available, or everything published has been suppressed."
              />
            )}
          </section>

          <section className="mb-8">
            <h2 className="text-sm font-semibold text-neutral-900 mb-1">Supporting cards</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Pinned supporting items appear first, then the next most recent eligible items.
            </p>
            {supporting.length === 0 ? (
              <EmptyState title="No supporting items" description="Publish more content to fill the trending block." />
            ) : (
              <div className="flex flex-col gap-2">
                {supporting.map((r) => {
                  const o = overrideByContentId.get(r.id);
                  return (
                    <Card key={r.id} className="p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-neutral-900">
                            <TextLink href={`/admin/content/${r.id}`}>{r.title}</TextLink>
                          </p>
                          <p className="text-xs text-neutral-500 mt-0.5">
                            {r.category_id ? (categoryNameById.get(r.category_id) ?? "—") : "no category"} ·{" "}
                            published {formatDateTime(r.published_at)}
                          </p>
                        </div>
                        {o && <Badge tone={MODE_TONE[o.mode] ?? "neutral"}>{MODE_LABEL[o.mode] ?? o.mode}</Badge>}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          <section className="mb-8">
            <h2 className="text-sm font-semibold text-neutral-900 mb-1">Active overrides</h2>
            <p className="text-xs text-neutral-500 mb-3">
              One override per content item. Setting a new mode for an item replaces its existing override.
            </p>
            {overrideRows.length === 0 ? (
              <EmptyState
                title="No overrides"
                description="The homepage is running entirely on the automatic ranking."
              />
            ) : (
              <div className="flex flex-col gap-2">
                {overrideRows.map((o) => (
                  <Card key={o.id} className="p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-neutral-900">
                          <TextLink href={`/admin/content/${o.content_id}`}>
                            {titleById.get(o.content_id) ?? "(item not in the recent published list)"}
                          </TextLink>
                        </p>
                        {o.note && <p className="text-xs text-neutral-500 mt-0.5">{o.note}</p>}
                        <p className="text-xs text-neutral-400 mt-0.5">Set {formatDateTime(o.created_at)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={MODE_TONE[o.mode] ?? "neutral"}>{MODE_LABEL[o.mode] ?? o.mode}</Badge>
                        <form action={removeHomepageOverride}>
                          <input type="hidden" name="id" value={o.id} />
                          <button
                            type="submit"
                            className="rounded px-2 py-1 text-xs font-medium text-neutral-700 border border-neutral-300 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                          >
                            Remove
                          </button>
                        </form>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-neutral-900 mb-1">Add or change an override</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Only published content is listed — an override on anything else would have no effect.
            </p>
            {rows.length === 0 ? (
              <EmptyState title="No published content" description="Publish something before pinning it." />
            ) : (
              <form action={setHomepageOverride} className="flex flex-col gap-3 max-w-xl">
                <Field label="Content item" htmlFor="content_id">
                  <Select id="content_id" name="content_id" required defaultValue="">
                    <option value="" disabled>
                      Choose published content
                    </option>
                    {rows.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Mode"
                  htmlFor="mode"
                  hint="Pin as lead promotes to the hero slot. Suppress removes it from the trending block without unpublishing it."
                >
                  <Select id="mode" name="mode" defaultValue="pin_supporting">
                    <option value="pin_lead">Pin as lead</option>
                    <option value="pin_supporting">Pin as supporting</option>
                    <option value="suppress">Suppress</option>
                  </Select>
                </Field>
                <Field label="Note" htmlFor="note" hint="Why, for whoever reads this later.">
                  <TextInput id="note" name="note" />
                </Field>
                <div>
                  <SubmitButton pendingLabel="Saving...">Save override</SubmitButton>
                </div>
              </form>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
