import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader,
  Card,
  Badge,
  Field,
  TextInput,
  Textarea,
  Select,
  Checkbox,
  EmptyState,
  QueryErrorBanner,
} from "@/components/admin/ui";
import { SubmitButton, ConfirmDeleteButton } from "@/components/admin/submit-button";
import type { EngineSource, EngineSourceType, MediaRightsStatus, TrustLevel } from "@/lib/engine/types";
import { createEngineSource, updateEngineSource, deleteEngineSource } from "../actions";
import { EngineTabs, MediaRightsBadge, TrustBadge, formatDateTime, humanise } from "../shared";

const SOURCE_TYPES: EngineSourceType[] = [
  "manufacturer_newsroom",
  "product_feed",
  "rss_atom",
  "official_docs",
  "public_api",
  "regulatory_dataset",
  "trusted_editorial",
  "other_approved",
];

const TRUST_LEVELS: TrustLevel[] = ["primary", "secondary", "community"];

const MEDIA_RIGHTS: MediaRightsStatus[] = [
  "unverified",
  "confirmed_usable",
  "requires_registration",
  "unclear_manual_review",
  "no_source_found",
  "prohibited",
];

// The three permissions this page exists to keep apart. Rendering them as
// three explicit yes/no statements — rather than three loose checkboxes — is
// deliberate: the failure mode being guarded against is someone reading any one
// of them as implying another. They escalate in seriousness left to right, and
// each is an independent fact established by reading that source's own terms.
function PermissionTriple({ source }: { source: EngineSource }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
      <div
        className={`rounded border p-2 ${
          source.discovery_permitted ? "border-green-200 bg-green-50" : "border-neutral-200 bg-neutral-50"
        }`}
      >
        <p className="text-xs font-semibold text-neutral-900">
          1. Read facts: {source.discovery_permitted ? "permitted" : "not permitted"}
        </p>
        <p className="text-[11px] text-neutral-600 mt-0.5">
          Discovery may extract information (specs, dates, announcements).
        </p>
      </div>
      <div
        className={`rounded border p-2 ${
          source.media_browsing_permitted ? "border-green-200 bg-green-50" : "border-neutral-200 bg-neutral-50"
        }`}
      >
        <p className="text-xs font-semibold text-neutral-900">
          2. Browse media: {source.media_browsing_permitted ? "permitted" : "not permitted"}
        </p>
        <p className="text-[11px] text-neutral-600 mt-0.5">
          We may look inside its image library. Looking is not using.
        </p>
      </div>
      <div
        className={`rounded border p-2 ${
          source.media_republication_permitted ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"
        }`}
      >
        <p className="text-xs font-semibold text-neutral-900">
          3. Republish media: {source.media_republication_permitted ? "permitted" : "NOT permitted"}
        </p>
        <p className="text-[11px] text-neutral-600 mt-0.5">
          The only one that lets an image go live. Never implied by 1 or 2.
        </p>
      </div>
    </div>
  );
}

export default async function EngineSourcesPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: sources, error } = await supabase
    .from("engine_sources")
    // One unbroken literal on purpose: supabase-js infers the row shape from
    // the select string's literal type, and a `+`-concatenated string widens to
    // `string`, which silently degrades the result type.
    .select(
      "id, organisation, url, source_type, categories, trust_level, is_active, discovery_permitted, media_browsing_permitted, media_republication_permitted, media_rights_status, editorial_use_only, registration_required, last_reviewed_at, reviewed_by, terms_url, terms_notes, attribution_required, attribution_text, check_frequency_hours, last_checked_at, last_success_at, consecutive_failures, last_error"
    )
    .order("organisation");

  const rows = (sources ?? []) as EngineSource[];

  return (
    <div>
      <PageHeader
        title="Source registry"
        description="Sources the engine is permitted to inspect. Permission to read information is tracked separately from permission to republish imagery."
      />
      <EngineTabs current="/admin/engine/sources" />

      <Card className="p-4 mb-6 border-amber-200 bg-amber-50">
        <p className="text-sm font-medium text-neutral-900">Three different permissions</p>
        <p className="text-xs text-neutral-700 mt-1">
          <strong>Read facts</strong> means discovery may extract information (specs, dates, announcements).{" "}
          <strong>Browse media</strong> means we may look inside that source&apos;s image library.{" "}
          <strong>Republish media</strong> means we may host its pictures on TechCarvalho. They are independent: a
          source can permit the first two and prohibit the third, and that is the common case. Never set one because
          another is set; each needs its own reading of the terms.
        </p>
      </Card>

      {error && <QueryErrorBanner message={`Failed to load sources: ${error.message}`} />}

      {!error && rows.length === 0 ? (
        <EmptyState
          title="No sources registered"
          description="Add a source below. Nothing is inspected until a source is registered, active and permitted for discovery."
        />
      ) : (
        !error && (
          <div className="flex flex-col gap-3 mb-8">
            {rows.map((s) => (
              <Card key={s.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900">{s.organisation}</p>
                    <p className="text-xs text-neutral-500 break-all">{s.url}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={s.is_active ? "green" : "neutral"}>{s.is_active ? "Active" : "Inactive"}</Badge>
                    <Badge tone="neutral">{humanise(s.source_type)}</Badge>
                    <TrustBadge level={s.trust_level} />
                    <MediaRightsBadge status={s.media_rights_status} />
                    {s.editorial_use_only && <Badge tone="blue">Editorial use only</Badge>}
                    {s.registration_required && <Badge tone="amber">Registration required</Badge>}
                  </div>
                </div>

                <PermissionTriple source={s} />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-3 text-xs text-neutral-600">
                  <p>Categories: {s.categories.length > 0 ? s.categories.join(", ") : "—"}</p>
                  <p>Check every {s.check_frequency_hours}h</p>
                  <p>Last checked: {formatDateTime(s.last_checked_at)}</p>
                  <p>Last success: {formatDateTime(s.last_success_at)}</p>
                  <p>
                    Consecutive failures:{" "}
                    <span className={s.consecutive_failures > 0 ? "text-red-700 font-medium" : ""}>
                      {s.consecutive_failures}
                    </span>
                  </p>
                  <p>Attribution required: {s.attribution_required ? "Yes" : "No"}</p>
                  <p>Last reviewed: {formatDateTime(s.last_reviewed_at)}</p>
                  <p>Reviewed by: {s.reviewed_by ?? "—"}</p>
                </div>

                {s.attribution_text && (
                  <p className="text-xs text-neutral-600 mt-2">Attribution text: {s.attribution_text}</p>
                )}
                {s.terms_url && (
                  <p className="text-xs text-neutral-600 mt-1 break-all">Terms: {s.terms_url}</p>
                )}
                {s.terms_notes && <p className="text-xs text-neutral-600 mt-1">{s.terms_notes}</p>}
                {s.last_error && <p className="text-xs text-red-700 mt-2">Last error: {s.last_error}</p>}

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-neutral-700">Edit source</summary>
                  <form action={updateEngineSource.bind(null, s.id)} className="flex flex-col gap-3 mt-3 max-w-xl">
                    <Field label="Source type" htmlFor={`type-${s.id}`}>
                      <Select id={`type-${s.id}`} name="source_type" defaultValue={s.source_type}>
                        {SOURCE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {humanise(t)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Trust level" htmlFor={`trust-${s.id}`}>
                      <Select id={`trust-${s.id}`} name="trust_level" defaultValue={s.trust_level}>
                        {TRUST_LEVELS.map((t) => (
                          <option key={t} value={t}>
                            {humanise(t)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label="Categories"
                      htmlFor={`cats-${s.id}`}
                      hint="Comma-separated category slugs this source is relevant to."
                    >
                      <TextInput id={`cats-${s.id}`} name="categories" defaultValue={s.categories.join(", ")} />
                    </Field>
                    <Field label="Check frequency (hours)" htmlFor={`freq-${s.id}`}>
                      <TextInput
                        id={`freq-${s.id}`}
                        name="check_frequency_hours"
                        type="number"
                        min={1}
                        defaultValue={s.check_frequency_hours}
                      />
                    </Field>
                    <Checkbox name="is_active" label="Active" defaultChecked={s.is_active} />
                    <Checkbox
                      name="discovery_permitted"
                      label="1. Read facts from this source (discovery permitted)"
                      defaultChecked={s.discovery_permitted}
                    />
                    <Checkbox
                      name="media_browsing_permitted"
                      label="2. Browse this source media library"
                      defaultChecked={s.media_browsing_permitted}
                    />
                    <div className="rounded border border-amber-200 bg-amber-50 p-2">
                      <Checkbox
                        name="media_republication_permitted"
                        label="3. Republish imagery from this source"
                        defaultChecked={s.media_republication_permitted}
                      />
                      <p className="text-[11px] text-amber-800 mt-1">
                        Only tick this if the source&apos;s actual terms have been read and permit it.
                      </p>
                    </div>
                    <Field label="Media rights status" htmlFor={`rights-${s.id}`}>
                      <Select id={`rights-${s.id}`} name="media_rights_status" defaultValue={s.media_rights_status}>
                        {MEDIA_RIGHTS.map((r) => (
                          <option key={r} value={r}>
                            {humanise(r)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Terms URL" htmlFor={`terms-${s.id}`}>
                      <TextInput id={`terms-${s.id}`} name="terms_url" type="url" defaultValue={s.terms_url ?? ""} />
                    </Field>
                    <Field label="Terms notes" htmlFor={`tnotes-${s.id}`}>
                      <Textarea id={`tnotes-${s.id}`} name="terms_notes" rows={2} defaultValue={s.terms_notes ?? ""} />
                    </Field>
                    <Checkbox
                      name="editorial_use_only"
                      label="Editorial use only (no commercial or promotional use)"
                      defaultChecked={s.editorial_use_only}
                    />
                    <Checkbox
                      name="registration_required"
                      label="Registration or accreditation required first"
                      defaultChecked={s.registration_required}
                    />
                    <Checkbox
                      name="attribution_required"
                      label="Attribution required"
                      defaultChecked={s.attribution_required}
                    />
                    <Field label="Attribution text" htmlFor={`atext-${s.id}`}>
                      <TextInput id={`atext-${s.id}`} name="attribution_text" defaultValue={s.attribution_text ?? ""} />
                    </Field>
                    <Field
                      label="Reviewed by"
                      hint="Who last read the terms for this source. Saving stamps the review date."
                      htmlFor={`revby-${s.id}`}
                    >
                      <TextInput id={`revby-${s.id}`} name="reviewed_by" defaultValue={s.reviewed_by ?? ""} />
                    </Field>
                    <div>
                      <SubmitButton pendingLabel="Saving...">Save source</SubmitButton>
                    </div>
                  </form>
                  <form action={deleteEngineSource} className="mt-2">
                    <input type="hidden" name="id" value={s.id} />
                    <ConfirmDeleteButton
                      confirmMessage={`Delete the source "${s.organisation}"? Existing evidence rows keep their URLs but lose the link to this source.`}
                      label="Delete source"
                    />
                  </form>
                </details>
              </Card>
            ))}
          </div>
        )
      )}

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Add a source</h2>
        <form action={createEngineSource} className="flex flex-col gap-3 max-w-xl">
          <Field label="Organisation" htmlFor="organisation">
            <TextInput id="organisation" name="organisation" required />
          </Field>
          <Field label="URL" htmlFor="url">
            <TextInput id="url" name="url" type="url" required />
          </Field>
          <Field label="Source type" htmlFor="source_type">
            <Select id="source_type" name="source_type" defaultValue="manufacturer_newsroom">
              {SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanise(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Trust level" htmlFor="trust_level">
            <Select id="trust_level" name="trust_level" defaultValue="secondary">
              {TRUST_LEVELS.map((t) => (
                <option key={t} value={t}>
                  {humanise(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Categories" htmlFor="categories" hint="Comma-separated category slugs.">
            <TextInput id="categories" name="categories" />
          </Field>
          <Field label="Check frequency (hours)" htmlFor="check_frequency_hours">
            <TextInput id="check_frequency_hours" name="check_frequency_hours" type="number" min={1} defaultValue={24} />
          </Field>
          <Checkbox name="is_active" label="Active" />
          <Checkbox name="discovery_permitted" label="1. Read facts from this source (discovery permitted)" />
          <Checkbox name="media_browsing_permitted" label="2. Browse this source media library" />
          <div className="rounded border border-amber-200 bg-amber-50 p-2">
            <Checkbox name="media_republication_permitted" label="3. Republish imagery from this source" />
            <p className="text-[11px] text-amber-800 mt-1">
              Leave unticked unless the source&apos;s actual terms have been read and permit republication.
            </p>
          </div>
          <Field
            label="Media rights status"
            htmlFor="media_rights_status"
            hint="Stays 'unverified' until someone has actually read the terms."
          >
            <Select id="media_rights_status" name="media_rights_status" defaultValue="unverified">
              {MEDIA_RIGHTS.map((r) => (
                <option key={r} value={r}>
                  {humanise(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Terms URL" htmlFor="terms_url">
            <TextInput id="terms_url" name="terms_url" type="url" />
          </Field>
          <Field label="Terms notes" htmlFor="terms_notes">
            <Textarea id="terms_notes" name="terms_notes" rows={2} />
          </Field>
          <Checkbox name="editorial_use_only" label="Editorial use only (no commercial or promotional use)" />
          <Checkbox name="registration_required" label="Registration or accreditation required first" />
          <Checkbox name="attribution_required" label="Attribution required" />
          <Field label="Attribution text" htmlFor="attribution_text">
            <TextInput id="attribution_text" name="attribution_text" />
          </Field>
          <Field label="Reviewed by" htmlFor="reviewed_by" hint="Who read the terms for this source, if anyone has.">
            <TextInput id="reviewed_by" name="reviewed_by" />
          </Field>
          <div>
            <SubmitButton pendingLabel="Adding...">Add source</SubmitButton>
          </div>
        </form>
      </Card>
    </div>
  );
}
