import type { MediaRightsStatus, MediaSourceType, MediaSourcingStatus } from "@/lib/types/database";
import { evaluatePublishEligibility } from "./rights.ts";

export type MediaReadiness = { ready: true } | { ready: false; reason: string };

// The single gate a future batch/manual publish flow should call before
// marking a product/content record as its final publication state (product
// is_published=true, or content status='published'). Deliberately reuses
// evaluatePublishEligibility() rather than re-implementing rights logic —
// this only adds the two things that function doesn't cover: whether a
// hero association exists at all, and whether an open sourcing-workflow
// requirement has actually reached 'approved'.
//
// Pure and synchronous by design (like evaluatePublishEligibility) so a
// batch process can call it per-record without any extra DB round trip
// beyond the two reads (hero asset, requirement row) it already needs to
// do anyway.
export function evaluateMediaReadiness(input: {
  heroAsset: { rights_status?: MediaRightsStatus; owned?: boolean; source_type?: MediaSourceType | null } | null;
  requirement?: { sourcing_status: MediaSourcingStatus } | null;
}): MediaReadiness {
  if (!input.heroAsset) {
    return { ready: false, reason: "No hero media associated yet." };
  }

  const eligibility = evaluatePublishEligibility(input.heroAsset);
  if (!eligibility.allowed) {
    return { ready: false, reason: eligibility.reason };
  }

  if (input.requirement && input.requirement.sourcing_status !== "approved") {
    return {
      ready: false,
      reason: `Media sourcing status is '${input.requirement.sourcing_status}', not yet approved.`,
    };
  }

  return { ready: true };
}
