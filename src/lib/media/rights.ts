import type { MediaRightsStatus, MediaSourceType } from "@/lib/types/database";

export type PublishEligibility = { allowed: true } | { allowed: false; reason: string };

// Single source of truth for "can this asset be published" — used by both
// the publishMediaAsset() Server Action (the real enforcement point) and
// the admin UI (to explain the block before the admin even clicks Publish).
// Deliberately does NOT treat source_url, attribution text, or a
// manufacturer/stock source_type as proof of rights on their own — only an
// explicit 'verified' rights_status, Tech-Carvalho ownership, or a staff
// photograph clears an asset for publication. 'restricted' always wins.
export function evaluatePublishEligibility(asset: {
  rights_status?: MediaRightsStatus;
  owned?: boolean;
  source_type?: MediaSourceType | null;
}): PublishEligibility {
  const rightsStatus = asset.rights_status ?? "unknown";

  if (rightsStatus === "restricted") {
    return { allowed: false, reason: "This asset is marked restricted and cannot be published." };
  }

  if (rightsStatus === "verified") return { allowed: true };
  if (asset.owned) return { allowed: true };
  if (asset.source_type === "staff_photograph") return { allowed: true };

  return {
    allowed: false,
    reason:
      "Usage rights for this asset haven't been verified. Mark rights status as Verified, or confirm it's Tech Carvalho's own work (Owned), before publishing.",
  };
}
