import { createClient } from "@/lib/supabase/server";
import { getAdminPreviewUrl } from "@/lib/media/admin-preview-url";
import { hasUnusableThumbnail, resolveCardImage, type SlotRow } from "@/lib/media/hero-slot";
import { evaluatePublishEligibility } from "@/lib/media/rights";
import { updateTargetSlots } from "@/app/admin/(dashboard)/media/slot-actions";
import { Card } from "./ui";
import { MediaSlotsPanel, type SlotAsset, type SlotsView } from "./media-slots-panel";
import type { Row } from "@/lib/types/database";

/**
 * Media slots for one product or article, editable in place.
 *
 * Loads the current hero/thumbnail/gallery, works out what a card will actually
 * show, and explains — per asset — whether it can appear publicly at all.
 *
 * The renderability line is the point of this component as much as the editing
 * is. The earlier audit found a hero association whose asset was still private:
 * the admin looked correct, the page showed nothing, and there was no way to
 * see why from either end.
 */
export async function MediaSlots({
  kind,
  targetId,
  targetLabel,
}: {
  kind: "product" | "content";
  targetId: string;
  targetLabel: string;
}) {
  const supabase = await createClient();

  const linksResult =
    kind === "product"
      ? await supabase.from("product_media").select("id, media_id, role, sort_order").eq("product_id", targetId)
      : await supabase.from("content_media").select("id, media_id, role, sort_order").eq("content_id", targetId);

  if (linksResult.error) {
    return (
      <Card className="p-5">
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Media</h2>
        <p role="alert" className="text-sm text-red-800">
          Couldn&apos;t load media associations: {linksResult.error.message}
        </p>
      </Card>
    );
  }

  const links = (linksResult.data ?? []) as { id: string; media_id: string; role: SlotRow["role"]; sort_order: number }[];

  const { data: assetRows } = links.length
    ? await supabase.from("media_assets").select("*").in("id", [...new Set(links.map((l) => l.media_id))])
    : { data: [] as Row<"media_assets">[] };
  const assetById = new Map((assetRows ?? []).map((a) => [a.id, a]));

  const slotRows: SlotRow[] = links.map((l) => {
    const asset = assetById.get(l.media_id);
    return {
      mediaId: l.media_id,
      rowId: l.id,
      role: l.role,
      sortOrder: l.sort_order ?? 0,
      renderable: asset?.publication_status === "published" && Boolean(asset?.public_storage_path),
    };
  });

  async function toSlotAsset(link: { media_id: string; sort_order: number }): Promise<SlotAsset> {
    const asset = assetById.get(link.media_id);
    const renderable = asset?.publication_status === "published" && Boolean(asset?.public_storage_path);

    // Why it cannot render, phrased as the next action rather than a status.
    let blockedReason: string | null = null;
    if (asset && !renderable) {
      const eligibility = evaluatePublishEligibility(asset);
      blockedReason = eligibility.allowed
        ? "Private — will not appear on the public site until you publish it from the media page."
        : `Cannot be published: ${eligibility.reason}`;
    } else if (!asset) {
      blockedReason = "The underlying media record is missing.";
    }

    const descriptorParts = [
      asset?.asset_role ? asset.asset_role.replace(/_/g, " ") : "no editorial role",
      asset?.source_type ? asset.source_type.replace(/_/g, " ") : "no source type",
    ];
    if (asset?.ai_generated) descriptorParts.push("AI-generated");

    return {
      mediaId: link.media_id,
      alt: asset?.alt_text ?? null,
      previewUrl: asset ? await getAdminPreviewUrl(asset) : null,
      descriptor: descriptorParts.join(" · "),
      renderable,
      blockedReason,
      sortOrder: link.sort_order ?? 0,
    };
  }

  const heroLink = links.find((l) => l.role === "hero") ?? null;
  const thumbLink = links.find((l) => l.role === "thumbnail") ?? null;
  const galleryLinks = links
    .filter((l) => l.role === "gallery")
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id));

  // The library to attach from. Newest first, and labelled with enough to tell
  // two similar images apart without opening them.
  const { data: library } = await supabase
    .from("media_assets")
    .select("id, alt_text, storage_path, asset_role, publication_status")
    .order("created_at", { ascending: false })
    .limit(300);

  const view: SlotsView = {
    hero: heroLink ? await toSlotAsset(heroLink) : null,
    thumbnail: thumbLink ? await toSlotAsset(thumbLink) : null,
    gallery: await Promise.all(galleryLinks.map(toSlotAsset)),
    cardImage: resolveCardImage(slotRows),
    thumbnailUnusable: hasUnusableThumbnail(slotRows),
    library: (library ?? []).map((a) => ({
      id: a.id,
      label:
        (a.alt_text?.trim() || a.storage_path.split("/").pop() || a.id).slice(0, 70) +
        (a.asset_role ? ` [${a.asset_role.replace(/_/g, " ")}]` : "") +
        (a.publication_status === "published" ? "" : " (private)"),
    })),
  };

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-sm font-semibold text-neutral-900">Media</h2>
      <p className="mb-4 text-xs text-neutral-500">
        Hero, card image and gallery for this {kind === "product" ? "product" : "article"}. One asset can serve many
        pages — attaching it here does not copy it.
      </p>
      <MediaSlotsPanel
        action={updateTargetSlots.bind(null, kind, targetId)}
        view={view}
        targetLabel={targetLabel}
      />
    </Card>
  );
}
