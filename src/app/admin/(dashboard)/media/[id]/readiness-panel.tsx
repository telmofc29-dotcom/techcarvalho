import Link from "next/link";
import { Card } from "@/components/admin/ui";
import { evaluatePublishEligibility } from "@/lib/media/rights";
import { detectPreset, CLASSIFICATION_PRESETS } from "@/lib/media/classification-presets";
import type { Row } from "@/lib/types/database";

// "Is this actually going to appear on the site?"
//
// WHY THIS EXISTS
// ---------------
// Rights verification and publication are two different things, and both are
// worth keeping separate: an asset can be legally cleared and deliberately not
// live. But the admin made them look like one workflow. It was entirely
// possible to classify an image, verify its rights, attach it to a published
// article, see green ticks everywhere — and have the page render nothing,
// because the asset was still private. That happened, twice, on live articles.
//
// So the two states are shown side by side, with the overall verdict stated in
// one sentence at the top. Nothing here changes behaviour; it makes the
// existing behaviour impossible to misread.
export function ReadinessPanel({
  asset,
  usageCount,
  hasPublicUsage,
}: {
  asset: Row<"media_assets">;
  usageCount: number;
  /** Attached to at least one PUBLISHED product or article. */
  hasPublicUsage: boolean;
}) {
  const eligibility = evaluatePublishEligibility(asset);
  const published = asset.publication_status === "published" && Boolean(asset.public_storage_path);
  const presetId = detectPreset(asset);
  const preset = CLASSIFICATION_PRESETS.find((p) => p.id === presetId) ?? null;
  const hasAlt = Boolean(asset.alt_text?.trim());

  const rows: { label: string; ok: boolean; warn?: boolean; detail: string }[] = [
    {
      label: "Rights",
      ok: asset.rights_status === "verified",
      detail:
        asset.rights_status === "verified"
          ? `Verified${asset.owned ? " · owned by Tech Carvalho" : ""}`
          : `${(asset.rights_status ?? "unknown").replace(/_/g, " ")} — ${eligibility.allowed ? "publishable" : eligibility.reason}`,
    },
    {
      label: "Classification",
      ok: preset !== null,
      detail: preset ? preset.label : "Not classified — answer “Where did this file come from?” above",
    },
    {
      label: "Alt text",
      ok: hasAlt,
      warn: !hasAlt,
      detail: hasAlt ? "Present" : "Missing — needed for accessibility before this is used as a hero or card",
    },
    {
      label: "Publication",
      ok: published,
      warn: !published,
      detail: published ? "Published — visible on the public site" : "PRIVATE — not visible on the public site",
    },
    {
      label: "Used on",
      ok: usageCount > 0,
      detail: usageCount === 0 ? "Not attached to anything yet" : `${usageCount} slot${usageCount === 1 ? "" : "s"}`,
    },
  ];

  // The verdict, stated once. The dangerous combination is "attached to
  // something public, but private" — a page that silently shows nothing.
  const verdict = published
    ? { tone: "ok" as const, text: "Visible on the public site." }
    : hasPublicUsage
      ? {
          tone: "warn" as const,
          text: "Attached to published content but NOT published — those pages are not showing this image.",
        }
      : { tone: "info" as const, text: "Not published. It will not appear publicly until you publish it." };

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-sm font-semibold text-neutral-900">Ready for public use?</h2>
      <div
        className={`mb-3 rounded-lg border px-4 py-3 text-sm ${
          verdict.tone === "ok"
            ? "border-green-200 bg-green-50 text-green-900"
            : verdict.tone === "warn"
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-neutral-200 bg-neutral-50 text-neutral-700"
        }`}
      >
        {verdict.text}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="flex items-center gap-2 font-medium text-neutral-700">
              <span aria-hidden="true" className={row.ok ? "text-green-600" : row.warn ? "text-amber-600" : "text-neutral-400"}>
                {row.ok ? "✓" : row.warn ? "⚠" : "·"}
              </span>
              {row.label}
            </dt>
            <dd className={row.ok ? "text-neutral-700" : "text-amber-800"}>{row.detail}</dd>
          </div>
        ))}
      </dl>

      {!published && (
        <p className="mt-3 text-xs text-neutral-500">
          Publishing copies the file into the public bucket. The private master is never modified or removed — see{" "}
          <Link href="/admin/media" className="underline">
            the media library
          </Link>
          .
        </p>
      )}
    </Card>
  );
}
