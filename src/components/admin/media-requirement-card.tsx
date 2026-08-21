import { Card, Field, Select, Textarea, Badge, TextLink } from "@/components/admin/ui";
import { SubmitButton } from "@/components/admin/submit-button";
import { evaluateMediaReadiness } from "@/lib/media/requirements";
import { upsertMediaRequirement } from "@/app/admin/(dashboard)/media/requirement-actions";
import type { MediaRightsStatus, MediaSourceType, MediaSourcingStatus } from "@/lib/types/database";

const SOURCING_STATUS_OPTIONS: { value: MediaSourcingStatus; label: string }[] = [
  { value: "needed", label: "Needed" },
  { value: "sourcing", label: "Sourcing" },
  { value: "available", label: "Available" },
  { value: "blocked", label: "Blocked" },
  { value: "approved", label: "Approved" },
];

const SOURCE_TYPE_OPTIONS: { value: MediaSourceType; label: string }[] = [
  { value: "manufacturer", label: "Manufacturer" },
  { value: "staff_photograph", label: "Staff photograph" },
  { value: "stock_licensed", label: "Stock (licensed)" },
  { value: "user_submitted", label: "User submitted" },
  { value: "press_kit", label: "Press kit" },
  { value: "public_domain_or_cc", label: "Public domain / Creative Commons" },
  { value: "tc_graphic", label: "TechCarvalho-created graphic/diagram" },
  { value: "other", label: "Other" },
];

// Shared between the product and content edit surfaces (Section: "Media
// Requirements admin workflow" — integrated into the existing edit pages
// rather than a separate subsystem, per explicit instruction). Rights/
// provenance itself stays entirely in media_assets/evaluatePublishEligibility
// — this card only shows the sourcing-workflow state and the readiness
// verdict, never a second copy of licence/attribution text.
export function MediaRequirementCard({
  target,
  requirement,
  heroAsset,
  associatedMedia,
}: {
  target: { productId: string } | { contentId: string };
  requirement: {
    id: string;
    sourcing_status: MediaSourcingStatus;
    target_source_type: MediaSourceType | null;
    notes: string | null;
    resolved_media_id: string | null;
  } | null;
  heroAsset: { rights_status?: MediaRightsStatus; owned?: boolean; source_type?: MediaSourceType | null } | null;
  associatedMedia: { id: string; label: string }[];
}) {
  const readiness = evaluateMediaReadiness({ heroAsset, requirement });
  const action = upsertMediaRequirement.bind(null, target);

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-sm font-semibold text-neutral-900">Media requirement</h2>
        <Badge tone={readiness.ready ? "green" : "amber"}>
          {readiness.ready ? "Passes media gate" : "Blocked"}
        </Badge>
      </div>
      <p className="text-xs text-neutral-500 mb-3">
        {readiness.ready
          ? "This record has a hero image with cleared rights — eligible to publish as far as media is concerned."
          : readiness.reason}
        {" "}Rights and provenance stay on the Media asset itself — see the{" "}
        <TextLink href="/admin/media">Media area</TextLink>; this card only tracks sourcing progress.
      </p>

      <form action={action} className="flex flex-col gap-4">
        <Field label="Sourcing status" htmlFor="sourcing_status">
          <Select id="sourcing_status" name="sourcing_status" defaultValue={requirement?.sourcing_status ?? "needed"}>
            {SOURCING_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Intended source type" htmlFor="target_source_type" hint="Where you expect this to come from, if known yet.">
          <Select id="target_source_type" name="target_source_type" defaultValue={requirement?.target_source_type ?? ""}>
            <option value="">Not decided yet</option>
            {SOURCE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" htmlFor="notes">
          <Textarea id="notes" name="notes" rows={2} defaultValue={requirement?.notes ?? ""} />
        </Field>
        <Field
          label="Resolved media asset"
          htmlFor="resolved_media_id"
          hint="Once you've uploaded and associated the real asset, point this at it."
        >
          <Select id="resolved_media_id" name="resolved_media_id" defaultValue={requirement?.resolved_media_id ?? ""}>
            <option value="">None yet</option>
            {associatedMedia.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <SubmitButton pendingLabel="Saving...">Save requirement</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
