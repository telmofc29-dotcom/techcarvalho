import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getRowById, listRows } from "@/lib/admin/reference-service";
import { PageHeader, Card, Checkbox, Field, TextInput, Select, Badge, TextLink } from "@/components/admin/ui";
import { SubmitButton, ConfirmDeleteButton } from "@/components/admin/submit-button";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { SourceRecordsCard, EvidenceRecordsCard } from "@/components/admin/source-evidence-cards";
import { MediaRequirementCard } from "@/components/admin/media-requirement-card";
import { MediaSlots } from "@/components/admin/media-slots";
import { CannibalisationCheck } from "@/components/admin/cannibalisation-check";
import { CONTENT_TYPE_OPTIONS, CONTENT_STATUS_OPTIONS } from "@/lib/admin/content-options";
import {
  updateContentItem,
  updateContentTags,
  updateContentProducts,
  updateContentSeo,
  logContentFreshnessReview,
  archiveContentItem,
  addContentRelationship,
  deleteContentRelationship,
} from "../actions";
import type { ContentRelationshipType } from "@/lib/types/database";

const CONTENT_RELATIONSHIP_LABELS: Record<ContentRelationshipType, string> = {
  pillar_of: "Pillar of",
  supporting_of: "Supporting of",
  related_to: "Related to",
};

const REVERSE_CONTENT_RELATIONSHIP_LABELS: Record<ContentRelationshipType, string> = {
  pillar_of: "Has pillar",
  supporting_of: "Has supporting content",
  related_to: "Related to",
};

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function EditContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const content = await getRowById("content_items", id);
  if (!content) notFound();

  const supabase = await createClient();
  const [
    { data: allTags },
    { data: contentTagRows },
    { data: allProducts },
    { data: contentProductRows },
    { data: seo },
    { data: freshnessEntries },
    categories,
    { data: mediaLinks },
    { data: sourceRecords },
    { data: evidenceRecords },
    { data: outgoingContentRel },
    { data: incomingContentRel },
  ] = await Promise.all([
    supabase.from("taxonomy_tags").select("*").order("name"),
    supabase.from("content_tags").select("tag_id").eq("content_id", id),
    supabase.from("products").select("id, name").order("name"),
    supabase.from("content_products").select("product_id, role").eq("content_id", id),
    supabase.from("seo_metadata").select("*").eq("content_id", id).maybeSingle(),
    supabase.from("freshness_log").select("*").eq("content_id", id).order("reviewed_at", { ascending: false }),
    listRows("taxonomy_categories", { orderBy: "name" }),
    supabase.from("content_media").select("media_id, role").eq("content_id", id),
    supabase
      .from("source_records")
      .select("id, url, publisher, reliability_tier, retrieved_at")
      .eq("content_id", id)
      .order("retrieved_at", { ascending: false }),
    supabase
      .from("evidence_records")
      .select("id, test_type, conditions, result_summary, tested_at")
      .eq("content_id", id)
      .order("tested_at", { ascending: false }),
    supabase.from("content_relationships").select("id, related_content_id, relationship_type").eq("content_id", id),
    supabase.from("content_relationships").select("id, content_id, relationship_type").eq("related_content_id", id),
  ]);

  const { data: otherContent } = await supabase
    .from("content_items")
    .select("id, title, primary_query, intent_fingerprint")
    .neq("status", "archived")
    .neq("id", id);

  const relatedContentIds = [
    ...(outgoingContentRel ?? []).map((r) => r.related_content_id),
    ...(incomingContentRel ?? []).map((r) => r.content_id),
  ];
  const { data: relatedContentRows } =
    relatedContentIds.length > 0
      ? await supabase.from("content_items").select("id, title").in("id", relatedContentIds)
      : { data: [] };
  const contentTitleById = new Map((relatedContentRows ?? []).map((c) => [c.id, c.title]));

  const selectedTagIds = new Set((contentTagRows ?? []).map((r) => r.tag_id));
  const roleByProductId = new Map((contentProductRows ?? []).map((r) => [r.product_id, r.role]));
  const productIds = (allProducts ?? []).map((p) => p.id);

  const mediaIds = (mediaLinks ?? []).map((m) => m.media_id);
  const { data: mediaRows } =
    mediaIds.length > 0
      ? await supabase
          .from("media_assets")
          .select("id, alt_text, storage_path, publication_status, rights_status, owned, source_type")
          .in("id", mediaIds)
      : { data: [] };
  const mediaById = new Map((mediaRows ?? []).map((m) => [m.id, m]));
  const heroLink = (mediaLinks ?? []).find((m) => m.role === "hero");
  const heroAsset = heroLink ? (mediaById.get(heroLink.media_id) ?? null) : null;
  const { data: mediaRequirement } = await supabase
    .from("media_requirements")
    .select("id, sourcing_status, target_source_type, notes, resolved_media_id")
    .eq("content_id", id)
    .maybeSingle();

  const fields: ReferenceFieldConfig[] = [
    {
      key: "type",
      label: "Content type",
      kind: "select",
      required: true,
      allowEmpty: false,
      options: CONTENT_TYPE_OPTIONS,
    },
    { key: "title", label: "Title", kind: "text", required: true },
    { key: "slug", label: "Slug", kind: "text" },
    {
      key: "body",
      label: "Body",
      kind: "textarea",
      hint: "Plain text. Blank lines separate paragraphs; \"## \"/\"### \" for headings, \"- \" for a bullet list.",
    },
    {
      key: "status",
      label: "Status",
      kind: "select",
      required: true,
      allowEmpty: false,
      options: CONTENT_STATUS_OPTIONS,
    },
    {
      key: "published_at",
      label: "Publish at",
      kind: "datetime",
      hint: "Content is only public once status is Published and this time has passed. Leave blank when setting Status to Published and it's filled in automatically with the current time.",
    },
    {
      key: "category_id",
      label: "Primary category",
      kind: "select",
      emptyLabel: "No category",
      options: categories.map((c) => ({ value: c.id, label: c.name })),
    },
    {
      key: "search_intent",
      label: "Search intent",
      kind: "select",
      emptyLabel: "Not specified",
      options: [
        { value: "informational", label: "Informational" },
        { value: "commercial", label: "Commercial" },
        { value: "transactional", label: "Transactional" },
        { value: "navigational", label: "Navigational" },
      ],
    },
    { key: "primary_query", label: "Primary target query", kind: "text" },
    { key: "intent_fingerprint", label: "Intent fingerprint", kind: "text" },
  ];

  const defaultValues = { ...content, published_at: toDatetimeLocal(content.published_at) };

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <div>
        <PageHeader
          title={`Edit ${content.title}`}
          action={
            content.status !== "archived" ? (
              <form action={archiveContentItem}>
                <input type="hidden" name="id" value={id} />
                <button type="submit" className="text-sm text-neutral-500 underline hover:text-neutral-800">
                  Archive
                </button>
              </form>
            ) : undefined
          }
        />
        <CannibalisationCheck
          existing={otherContent ?? []}
          initialTitle={content.title}
          initialPrimaryQuery={content.primary_query ?? ""}
          initialIntentFingerprint={content.intent_fingerprint ?? ""}
        >
          <ReferenceForm
            fields={fields}
            defaultValues={defaultValues}
            action={updateContentItem.bind(null, id)}
            submitLabel="Save changes"
          />
        </CannibalisationCheck>
      </div>

      <MediaSlots kind="content" targetId={id} targetLabel={content.title} />

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Tags</h2>
        {(allTags ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No taxonomy tags exist yet.</p>
        ) : (
          <form action={updateContentTags.bind(null, id)} className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {(allTags ?? []).map((tag) => (
                <Checkbox
                  key={tag.id}
                  name="tag_id"
                  value={tag.id}
                  label={tag.name}
                  defaultChecked={selectedTagIds.has(tag.id)}
                />
              ))}
            </div>
            <div>
              <SubmitButton pendingLabel="Saving tags...">Save tags</SubmitButton>
            </div>
          </form>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Product associations</h2>
        {(allProducts ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No products exist yet.</p>
        ) : (
          <form action={updateContentProducts.bind(null, id, productIds)} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              {(allProducts ?? []).map((product) => (
                <div key={product.id} className="flex items-center gap-3">
                  <span className="text-sm text-neutral-800 flex-1">{product.name}</span>
                  <Select name={`role_${product.id}`} defaultValue={roleByProductId.get(product.id) ?? ""} className="w-48">
                    <option value="">Not linked</option>
                    <option value="primary_subject">Primary subject</option>
                    <option value="mentioned">Mentioned</option>
                    <option value="compared_against">Compared against</option>
                  </Select>
                </div>
              ))}
            </div>
            <div>
              <SubmitButton pendingLabel="Saving associations...">Save associations</SubmitButton>
            </div>
          </form>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">SEO metadata</h2>
        <form action={updateContentSeo.bind(null, id)} className="flex flex-col gap-4">
          <Field label="Meta title" htmlFor="meta_title">
            <TextInput id="meta_title" name="meta_title" defaultValue={seo?.meta_title ?? ""} />
          </Field>
          <Field label="Meta description" htmlFor="meta_description">
            <TextInput id="meta_description" name="meta_description" defaultValue={seo?.meta_description ?? ""} />
          </Field>
          <Field label="Canonical URL" htmlFor="canonical_url">
            <TextInput id="canonical_url" name="canonical_url" type="url" defaultValue={seo?.canonical_url ?? ""} />
          </Field>
          <Checkbox name="noindex" label="noindex" defaultChecked={seo?.noindex ?? false} />
          <div>
            <SubmitButton pendingLabel="Saving SEO...">Save SEO metadata</SubmitButton>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Content relationships</h2>
        {(outgoingContentRel ?? []).length === 0 && (incomingContentRel ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500 mb-4">No relationships yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 mb-4">
            {(outgoingContentRel ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between text-sm">
                <span>
                  <Badge>{CONTENT_RELATIONSHIP_LABELS[r.relationship_type]}</Badge>{" "}
                  {contentTitleById.get(r.related_content_id) ?? "Unknown content"}
                </span>
                <form action={deleteContentRelationship}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="content_id" value={id} />
                  <ConfirmDeleteButton confirmMessage="Remove this relationship?" label="Remove" />
                </form>
              </li>
            ))}
            {(incomingContentRel ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between text-sm">
                <span>
                  <Badge tone="blue">{REVERSE_CONTENT_RELATIONSHIP_LABELS[r.relationship_type]}</Badge>{" "}
                  {contentTitleById.get(r.content_id) ?? "Unknown content"}
                </span>
                <form action={deleteContentRelationship}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="content_id" value={id} />
                  <ConfirmDeleteButton confirmMessage="Remove this relationship?" label="Remove" />
                </form>
              </li>
            ))}
          </ul>
        )}
        {(otherContent ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No other content exists yet to relate this one to.</p>
        ) : (
          <form action={addContentRelationship.bind(null, id)} className="flex flex-wrap items-end gap-3">
            <Field label="Related content" htmlFor="related_content_id">
              <Select id="related_content_id" name="related_content_id" required className="w-56">
                <option value="">Choose content</option>
                {(otherContent ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Relationship" htmlFor="relationship_type">
              <Select id="relationship_type" name="relationship_type" required className="w-48">
                {Object.entries(CONTENT_RELATIONSHIP_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton pendingLabel="Adding...">Add relationship</SubmitButton>
          </form>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-1">Media</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Managed from the Media Registry — associate this content from a media asset&apos;s edit page.
        </p>
        {(mediaLinks ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No media associated yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(mediaLinks ?? []).map((link) => {
              const asset = mediaById.get(link.media_id);
              if (!asset) return null;
              return (
                <li key={link.media_id} className="flex items-center justify-between text-sm">
                  <span>
                    <Badge>{link.role}</Badge> {asset.alt_text ?? asset.storage_path.split("/").pop()}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge tone={asset.publication_status === "published" ? "green" : "neutral"}>
                      {asset.publication_status}
                    </Badge>
                    <TextLink href={`/admin/media/${asset.id}`}>Edit</TextLink>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <MediaRequirementCard
        target={{ contentId: id }}
        requirement={mediaRequirement ?? null}
        heroAsset={heroAsset}
        associatedMedia={(mediaRows ?? []).map((m) => ({
          id: m.id,
          label: m.alt_text ?? m.storage_path.split("/").pop() ?? m.id,
        }))}
      />

      <SourceRecordsCard parent={{ type: "content", id }} records={sourceRecords ?? []} />

      <EvidenceRecordsCard parent={{ type: "content", id }} records={evidenceRecords ?? []} />

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Freshness</h2>
        <form action={logContentFreshnessReview.bind(null, id)} className="flex flex-col gap-3 mb-5">
          <Field label="Log a freshness review" htmlFor="reason" hint="Records that this content was checked/updated today.">
            <TextInput id="reason" name="reason" placeholder="e.g. Verified pricing and availability" required />
          </Field>
          <div>
            <SubmitButton pendingLabel="Logging...">Log review</SubmitButton>
          </div>
        </form>
        {(freshnessEntries ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No freshness reviews logged yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(freshnessEntries ?? []).map((entry) => (
              <li key={entry.id} className="text-sm text-neutral-700 flex items-center gap-2">
                <Badge tone="blue">{new Date(entry.reviewed_at).toLocaleDateString()}</Badge>
                {entry.reason}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
