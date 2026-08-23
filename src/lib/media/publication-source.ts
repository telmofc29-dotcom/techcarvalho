// WHICH FILE does the public bucket receive?
//
// THE PROBLEM THIS FIXES
// ----------------------
// publishMediaAsset() and bulkPublishMediaAssets() copy `asset.storage_path` —
// the MASTER — from media-private into media-public, at the same path. That is
// correct for everything currently in the library, and it quietly defeats the
// entire watermarking effort the moment owned photography exists: the
// full-resolution unmarked original would sit at a guessable public URL, one
// hop from the marked derivatives. Watermarking the derivatives while
// publishing the master is not a weaker version of protecting the work; it is
// no protection at all.
//
// THE RULE
// --------
// An asset that SHOULD be watermarked may only be published as a WATERMARKED
// DERIVATIVE. Everything else publishes its master exactly as it does today.
//
// That symmetry is deliberate and it is what makes this safe to ship now:
// shouldWatermark() currently refuses all 112 assets in the library, so this
// changes the behaviour of precisely nothing. It arms itself automatically on
// the first owned photograph, which is the only moment it matters.
//
// FAIL CLOSED, LOUDLY
// -------------------
// If an asset needs a watermarked derivative and none exists, publication is
// REFUSED — not silently downgraded to publishing the master, and not silently
// downgraded to publishing an unmarked derivative. Both of those are the
// original bug wearing a hat. The admin gets a sentence telling them the
// derivative has not been generated yet.
//
// MASTER RETENTION IS UNAFFECTED
// ------------------------------
// Nothing here touches media-private. The master is never modified, never
// moved and never deleted; it stays the permanent archive and evidence record,
// privately retrievable by an admin exactly as before. This decides only what
// the PUBLIC bucket is allowed to receive.
//
// Pure. No I/O, no storage calls, no database.

import { shouldWatermark, DERIVATIVE_PATH_PREFIX, type DerivativeAsset } from "./derivatives.ts";

/**
 * The subset of a media_derivatives row this decision needs.
 *
 * Deliberately minimal: if publication does not need a field, it does not
 * appear here, so this module cannot come to depend on one.
 */
export type PublishableDerivative = {
  id: string;
  storagePath: string;
  watermarked: boolean;
  width: number | null;
  crop: string | null;
  format: string | null;
};

export type PublicationSource =
  | {
      kind: "master";
      storagePath: string;
      /** Why publishing the master is the right answer for this asset. */
      reason: string;
    }
  | {
      kind: "derivative";
      storagePath: string;
      derivativeId: string;
      reason: string;
    };

export type PublicationDecision =
  | { allowed: true; source: PublicationSource }
  | { allowed: false; code: PublicationRefusal; reason: string };

export type PublicationRefusal =
  /** Owned original, but no watermarked derivative has been generated yet. */
  | "watermarked_derivative_missing"
  /** A derivative was offered but its path is not under derivatives/. */
  | "derivative_path_invalid"
  /** No master path recorded at all. */
  | "no_master_path";

/**
 * Prefer the LARGEST watermarked derivative of the natural crop.
 *
 * Natural, because a square or OG crop is a thumbnail for a specific slot and
 * is not what an article body or a product page should receive. Largest,
 * because the public copy is the one the site's own <Image> pipeline resizes
 * down from — handing it a 640px file would cap quality everywhere.
 */
function bestPublicDerivative(
  derivatives: readonly PublishableDerivative[]
): PublishableDerivative | null {
  const candidates = derivatives.filter(
    (d) => d.watermarked && (d.crop === "natural" || d.crop === null)
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, d) => ((d.width ?? 0) > (best.width ?? 0) ? d : best));
}

/**
 * Decide what the public bucket receives for one asset.
 *
 * This runs AFTER evaluatePublishEligibility, not instead of it. Rights
 * eligibility answers "may this be public at all"; this answers "in what form".
 * Both must pass, and neither can substitute for the other.
 */
export function resolvePublicationSource(
  asset: DerivativeAsset & { storage_path?: string | null },
  derivatives: readonly PublishableDerivative[] = []
): PublicationDecision {
  const masterPath = asset.storage_path ?? null;
  if (!masterPath) {
    return {
      allowed: false,
      code: "no_master_path",
      reason: "This asset has no stored file path, so there is nothing to publish.",
    };
  }

  const wm = shouldWatermark(asset);

  // The common case, and every asset in the library today: a third-party
  // photograph, a chart, a logo, a generated graphic. None of these may be
  // watermarked, so the master IS the correct public file and this behaves
  // exactly as it always has.
  if (!wm.watermark) {
    return {
      allowed: true,
      source: {
        kind: "master",
        storagePath: masterPath,
        reason:
          `Published as the original file. This asset is not watermarked (${wm.code}), ` +
          `so there is no marked version it should be publishing instead.`,
      },
    };
  }

  // An owned original. The public bucket must never receive the master.
  const chosen = bestPublicDerivative(derivatives);
  if (!chosen) {
    return {
      allowed: false,
      code: "watermarked_derivative_missing",
      reason:
        "This is our own photograph, so the public copy must be a watermarked derivative — " +
        "and none has been generated yet. Publishing the master would place the unmarked " +
        "full-resolution original at a public URL. Generate derivatives first, then publish.",
    };
  }

  // Structural: a derivative must live under derivatives/. If a row ever
  // claimed the master's own path, copying it would publish the master while
  // reporting that a derivative had been published — the bug, disguised.
  if (!chosen.storagePath.startsWith(DERIVATIVE_PATH_PREFIX)) {
    return {
      allowed: false,
      code: "derivative_path_invalid",
      reason:
        `The chosen derivative's path (${chosen.storagePath}) is not under ` +
        `${DERIVATIVE_PATH_PREFIX}, so it may be the master itself. Refusing to publish it.`,
    };
  }
  if (chosen.storagePath === masterPath) {
    return {
      allowed: false,
      code: "derivative_path_invalid",
      reason: "The chosen derivative points at the master's own path. Refusing to publish it.",
    };
  }

  return {
    allowed: true,
    source: {
      kind: "derivative",
      storagePath: chosen.storagePath,
      derivativeId: chosen.id,
      reason:
        `Published as a watermarked derivative (${chosen.width ?? "?"}px ${chosen.format ?? ""}`.trim() +
        "). The unmarked master stays private.",
    },
  };
}

/**
 * True when this asset must NOT have its master published.
 *
 * Exposed separately so an admin screen can warn before the publish button is
 * pressed, rather than only explaining the refusal afterwards.
 */
export function requiresWatermarkedDerivative(asset: DerivativeAsset): boolean {
  return shouldWatermark(asset).watermark;
}
