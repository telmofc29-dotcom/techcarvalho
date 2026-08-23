import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePublicationSource,
  requiresWatermarkedDerivative,
  type PublishableDerivative,
} from "./publication-source.ts";
import { shouldWatermark, type DerivativeAsset } from "./derivatives.ts";

// An asset that shouldWatermark() ACCEPTS. Kept in one place so that if the
// watermark gate ever tightens, these tests fail loudly rather than silently
// testing the refusal path and reporting success.
const ownedPhoto = {
  id: "asset-owned",
  media_type: "image",
  asset_role: "product_photo",
  source_type: "staff_photograph",
  owned: true,
  rights_status: "verified",
  ai_generated: false,
  licence_permits_modification: true,
  storage_path: "originals/canon-r5-front.jpg",
} as unknown as DerivativeAsset & { storage_path: string };

const thirdPartyPhoto = {
  id: "asset-cc",
  media_type: "image",
  asset_role: "product_photo",
  source_type: "public_domain_or_cc",
  owned: false,
  rights_status: "verified",
  ai_generated: false,
  storage_path: "originals/commons-r5.jpg",
} as unknown as DerivativeAsset & { storage_path: string };

const chart = {
  id: "asset-chart",
  media_type: "image",
  asset_role: "chart",
  source_type: "tc_graphic",
  owned: true,
  rights_status: "verified",
  ai_generated: false,
  storage_path: "originals/tc-chart-install-sizes.png",
} as unknown as DerivativeAsset & { storage_path: string };

const derivative = (over: Partial<PublishableDerivative> = {}): PublishableDerivative => ({
  id: "deriv-1",
  storagePath: "derivatives/asset-owned/natural-2048.avif",
  watermarked: true,
  width: 2048,
  crop: "natural",
  format: "avif",
  ...over,
});

test("the fixture really is watermarkable — otherwise these tests prove nothing", () => {
  assert.equal(shouldWatermark(ownedPhoto).watermark, true);
  assert.equal(requiresWatermarkedDerivative(ownedPhoto), true);
  assert.equal(requiresWatermarkedDerivative(thirdPartyPhoto), false);
  assert.equal(requiresWatermarkedDerivative(chart), false);
});

test("THE BUG: an owned original with no derivative is REFUSED, not published as the master", () => {
  const d = resolvePublicationSource(ownedPhoto, []);
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.code, "watermarked_derivative_missing");
  // The refusal must not be silently downgraded to publishing the master.
  assert.doesNotMatch(JSON.stringify(d), /originals\/canon-r5-front\.jpg/);
});

test("an owned original publishes its watermarked derivative, never the master", () => {
  const d = resolvePublicationSource(ownedPhoto, [derivative()]);
  assert.equal(d.allowed, true);
  assert.equal(d.allowed && d.source.kind, "derivative");
  assert.equal(d.allowed && d.source.storagePath, "derivatives/asset-owned/natural-2048.avif");
  assert.notEqual(d.allowed && d.source.storagePath, ownedPhoto.storage_path);
});

test("an UNWATERMARKED derivative does not satisfy the requirement", () => {
  // Publishing an unmarked derivative is the same failure at a smaller size.
  const d = resolvePublicationSource(ownedPhoto, [derivative({ watermarked: false })]);
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.code, "watermarked_derivative_missing");
});

test("a square or OG crop does not satisfy the requirement either", () => {
  const d = resolvePublicationSource(ownedPhoto, [
    derivative({ crop: "square", storagePath: "derivatives/asset-owned/square-256.avif" }),
    derivative({ crop: "og", storagePath: "derivatives/asset-owned/og-1200.avif" }),
  ]);
  assert.equal(d.allowed, false, "a thumbnail is not the public copy of the photograph");
});

test("the LARGEST natural watermarked derivative is chosen", () => {
  const d = resolvePublicationSource(ownedPhoto, [
    derivative({ id: "small", width: 640, storagePath: "derivatives/asset-owned/natural-640.avif" }),
    derivative({ id: "big", width: 2048, storagePath: "derivatives/asset-owned/natural-2048.avif" }),
    derivative({ id: "mid", width: 1080, storagePath: "derivatives/asset-owned/natural-1080.avif" }),
  ]);
  assert.equal(d.allowed && d.source.kind === "derivative" && d.source.derivativeId, "big");
});

test("a derivative whose path is the MASTER's path is refused", () => {
  // The bug in disguise: publishing the master while reporting a derivative.
  const d = resolvePublicationSource(ownedPhoto, [
    derivative({ storagePath: ownedPhoto.storage_path }),
  ]);
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.code, "derivative_path_invalid");
});

test("a derivative outside derivatives/ is refused", () => {
  const d = resolvePublicationSource(ownedPhoto, [
    derivative({ storagePath: "originals/sneaky.avif" }),
  ]);
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.code, "derivative_path_invalid");
});

test("NOTHING CHANGES for third-party media — the master is still published", () => {
  // This is what makes the change safe to ship today: every one of the 112
  // assets currently in the library takes this path.
  const d = resolvePublicationSource(thirdPartyPhoto, []);
  assert.equal(d.allowed, true);
  assert.equal(d.allowed && d.source.kind, "master");
  assert.equal(d.allowed && d.source.storagePath, thirdPartyPhoto.storage_path);
});

test("a chart publishes its master — a watermark over data is never wanted", () => {
  const d = resolvePublicationSource(chart, []);
  assert.equal(d.allowed, true);
  assert.equal(d.allowed && d.source.kind, "master");
});

test("an asset with no stored path is refused rather than publishing nothing", () => {
  const d = resolvePublicationSource({ ...thirdPartyPhoto, storage_path: null } as never, []);
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.code, "no_master_path");
});

test("the master path is never returned for an asset that must be watermarked", () => {
  // The single invariant this module exists to guarantee, asserted across every
  // derivative arrangement that could tempt it.
  const arrangements: PublishableDerivative[][] = [
    [],
    [derivative({ watermarked: false })],
    [derivative({ crop: "square" })],
    [derivative({ storagePath: ownedPhoto.storage_path })],
    [derivative({ storagePath: "originals/x.avif" })],
    [derivative()],
  ];
  for (const derivs of arrangements) {
    const d = resolvePublicationSource(ownedPhoto, derivs);
    if (d.allowed) {
      assert.notEqual(
        d.source.storagePath,
        ownedPhoto.storage_path,
        `master leaked with derivatives: ${JSON.stringify(derivs)}`
      );
    }
  }
});
