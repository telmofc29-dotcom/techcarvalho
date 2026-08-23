import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldWatermark,
  modificationPermission,
  planDerivatives,
  assertMasterRetained,
  masterOutput,
  widthsForCrop,
  heightForCrop,
  cropsForRole,
  isCroppable,
  formatsFor,
  fallbackFormat,
  derivativePath,
  RESPONSIVE_WIDTHS,
  THUMBNAIL_WIDTHS,
  MODERN_FORMATS,
  MIN_WATERMARK_WIDTH,
  DERIVATIVE_PATH_PREFIX,
  OG_WIDTH,
  OG_HEIGHT,
  type DerivativeAsset,
  type DerivativeOutput,
  type PipelineOutput,
} from "./derivatives.ts";
import { evaluatePublishEligibility } from "./rights.ts";

// The one shape that IS watermarkable: our own camera, owned outright, in a
// role where a mark obscures nothing. Every refusal test below is this object
// with exactly one field changed, so each test isolates one reason.
const OWNED_PHOTO: DerivativeAsset = {
  media_type: "image",
  source_type: "staff_photograph",
  asset_role: "product_photo",
  owned: true,
  ai_generated: false,
  rights_status: "verified",
  license: null,
  width: 4000,
  height: 3000,
  storage_path: "image/abc-canon-r6.jpg",
};

function withField(overrides: Partial<DerivativeAsset>): DerivativeAsset {
  return { ...OWNED_PHOTO, ...overrides };
}

/** Assert a refusal and its code, so a test cannot pass for the wrong reason. */
function refuses(asset: DerivativeAsset | null | undefined, code: string) {
  const decision = shouldWatermark(asset);
  assert.equal(decision.watermark, false);
  assert.equal(decision.watermark === false ? decision.code : null, code);
  assert.ok(
    decision.reason.length > 20,
    "a refusal must explain itself well enough for an admin to act on it"
  );
}

// ---------------------------------------------------------------------------
// The one case that is allowed
// ---------------------------------------------------------------------------

test("an owned staff photograph in a photographic role IS watermarked", () => {
  assert.equal(shouldWatermark(OWNED_PHOTO).watermark, true);
});

test("the other photographic roles are watermarkable too", () => {
  for (const role of ["article_hero", "category_hero", "homepage_feature", "banner"]) {
    assert.equal(shouldWatermark(withField({ asset_role: role })).watermark, true, role);
  }
});

test("an explicit licence_permits_modification=true also clears the modification gate", () => {
  const asset = withField({ license: "CC BY-SA 4.0", licence_permits_modification: true });
  assert.equal(shouldWatermark(asset).watermark, true);
});

// ---------------------------------------------------------------------------
// REFUSAL: nothing to judge
// ---------------------------------------------------------------------------

test("null asset is refused", () => refuses(null, "no_asset"));
test("undefined asset is refused", () => refuses(undefined, "no_asset"));

test("video is refused — this pipeline is stills only", () => {
  refuses(withField({ media_type: "video" }), "not_an_image");
});

test("an unrecorded media_type is refused, not assumed to be an image", () => {
  refuses(withField({ media_type: null }), "not_an_image");
});

// ---------------------------------------------------------------------------
// REFUSAL: restricted
// ---------------------------------------------------------------------------

test("a restricted asset is refused even though it is our own owned photograph", () => {
  refuses(withField({ rights_status: "restricted" }), "restricted");
});

// ---------------------------------------------------------------------------
// REFUSAL: logos and brand marks
// ---------------------------------------------------------------------------

test("asset_role 'logo_brand' is refused", () => {
  refuses(withField({ asset_role: "logo_brand" }), "brand_asset");
});

test("asset_role 'icon' is refused", () => {
  refuses(withField({ asset_role: "icon" }), "brand_asset");
});

test("any brand_role is refused, whatever the asset_role claims", () => {
  for (const brand of ["logo_full", "logo_full_tagline", "wordmark", "wordmark_tagline", "mark", "favicon", "og_image"]) {
    refuses(withField({ brand_role: brand, asset_role: "product_photo" }), "brand_asset");
  }
});

test("a brand asset is refused even when it is our own owned photograph", () => {
  refuses(withField({ brand_role: "mark", source_type: "staff_photograph", owned: true }), "brand_asset");
});

// ---------------------------------------------------------------------------
// REFUSAL: diagrams, charts, comparison graphics
// ---------------------------------------------------------------------------

test("diagrams, charts and comparison graphics are refused — the mark would obscure the data", () => {
  for (const role of ["diagram", "chart", "comparison_graphic"]) {
    refuses(withField({ asset_role: role }), "information_graphic");
  }
});

test("a data-graphic FILENAME is refused even when the row claims a photographic role and source", () => {
  // classifyMediaTier() short-circuits on source_type='staff_photograph' and
  // never reaches the path, so this check has to be independent of it.
  for (const path of [
    "image/abc-cmp-ps5-vs-ps5pro.png",
    "image/abc-comparison-gpus.png",
    "image/abc-chart-bandwidth.png",
    "image/abc-spec_diagram-mount.png",
    "image/abc-timeline-rtx.png",
    "image/abc-p3-install-sizes.png",
  ]) {
    refuses(withField({ storage_path: path, asset_role: "article_hero" }), "information_graphic");
  }
});

test("an ordinary filename containing the letters of a keyword is not mistaken for a chart", () => {
  assert.equal(shouldWatermark(withField({ storage_path: "image/abc-comparison.jpg" })).watermark, true);
  assert.equal(shouldWatermark(withField({ storage_path: "image/abc-chartreuse-paint.jpg" })).watermark, true);
});

test("the graphic refusal outranks the source refusal, so the admin sees the specific reason", () => {
  // Both are true of a manufacturer-supplied chart. The useful reason is the chart.
  refuses(withField({ asset_role: "chart", source_type: "manufacturer", owned: false }), "information_graphic");
});

// ---------------------------------------------------------------------------
// REFUSAL: screenshots and other unsuitable roles
// ---------------------------------------------------------------------------

test("screenshots are refused — someone else's UI, and the mark covers it", () => {
  refuses(withField({ asset_role: "screenshot" }), "screenshot");
});

test("social_og and background are refused as unsuitable roles", () => {
  refuses(withField({ asset_role: "social_og" }), "unsuitable_role");
  refuses(withField({ asset_role: "background" }), "unsuitable_role");
});

test("an unrecognised future asset_role is refused rather than allowed by default", () => {
  refuses(withField({ asset_role: "some_role_added_next_year" }), "unsuitable_role");
});

// ---------------------------------------------------------------------------
// REFUSAL: unknown is never permission
// ---------------------------------------------------------------------------

test("a null asset_role is refused — nothing distinguishes a photograph from a diagram", () => {
  refuses(withField({ asset_role: null }), "unknown_role");
});

test("a null source_type is refused — no evidence it is our photograph", () => {
  refuses(withField({ source_type: null }), "unknown_source");
});

test("an empty object is refused", () => refuses({}, "not_an_image"));

test("an image with nothing else recorded is refused", () => {
  refuses({ media_type: "image" }, "unknown_role");
});

// ---------------------------------------------------------------------------
// REFUSAL: machine-generated
// ---------------------------------------------------------------------------

test("ai_generated is refused even when owned and staff-sourced", () => {
  refuses(withField({ ai_generated: true }), "ai_generated");
});

// ---------------------------------------------------------------------------
// REFUSAL: press kits and manufacturer media
// ---------------------------------------------------------------------------

test("press_kit media is refused — permission to publish is not permission to alter", () => {
  refuses(withField({ source_type: "press_kit", owned: false }), "press_kit");
});

test("manufacturer media is refused", () => {
  refuses(withField({ source_type: "manufacturer", owned: false }), "press_kit");
});

test("press_kit is still refused if someone ticks 'owned' on it", () => {
  refuses(withField({ source_type: "press_kit", owned: true, rights_status: "verified" }), "press_kit");
});

// ---------------------------------------------------------------------------
// REFUSAL: every other third-party source
// ---------------------------------------------------------------------------

test("every non-staff source type is refused", () => {
  for (const source of ["stock_licensed", "user_submitted", "public_domain_or_cc", "tc_graphic", "other"]) {
    refuses(withField({ source_type: source, owned: false }), "third_party_source");
  }
});

test("a third-party source is refused even when marked owned and verified", () => {
  // 'owned' on a Commons photograph is a data error, not a grant. The source
  // check runs before the ownership check precisely so this cannot pass.
  refuses(
    withField({ source_type: "public_domain_or_cc", owned: true, rights_status: "verified" }),
    "third_party_source"
  );
});

test("a source_url or attribution text is never treated as evidence of rights to alter", () => {
  refuses(
    withField({
      source_type: "stock_licensed",
      owned: false,
      license: "Royalty-free",
      attribution_required: true,
    }),
    "third_party_source"
  );
});

// ---------------------------------------------------------------------------
// REFUSAL: staff shot but not owned
// ---------------------------------------------------------------------------

test("a staff photograph that is not owned is refused", () => {
  refuses(withField({ owned: false }), "not_owned");
});

test("a staff photograph with owned unrecorded is refused", () => {
  refuses(withField({ owned: null }), "not_owned");
  refuses(withField({ owned: undefined }), "not_owned");
});

// ---------------------------------------------------------------------------
// REFUSAL: the licence forbids alteration
// ---------------------------------------------------------------------------

test("licence_permits_modification=false is refused", () => {
  refuses(withField({ licence_permits_modification: false }), "modification_forbidden");
});

test("a no-derivatives licence string is refused, and the flag cannot override it", () => {
  for (const licence of [
    "CC BY-ND 4.0",
    "CC BY-NC-ND 4.0",
    "cc-by-nd",
    "CC BY ND 3.0",
    "No Derivatives",
    "No-derivative works permitted",
    "ND 4.0",
  ]) {
    refuses(withField({ license: licence, licence_permits_modification: true }), "modification_forbidden");
  }
});

test("a licence permitting REUSE is not treated as permitting MODIFICATION", () => {
  // The whole point: CC BY-SA lets us republish, and says nothing here about
  // whether we may stamp our mark on it.
  refuses(withField({ license: "CC BY-SA 4.0" }), "modification_unknown");
  refuses(withField({ license: "CC BY 4.0" }), "modification_unknown");
  refuses(withField({ license: "Royalty-free, unlimited use" }), "modification_unknown");
});

test("'Standard licence' is not mistaken for a no-derivatives term", () => {
  const decision = shouldWatermark(withField({ license: "Standard licence", licence_permits_modification: true }));
  assert.equal(decision.watermark, true);
});

test("modificationPermission is tri-state and defaults to unknown", () => {
  assert.equal(modificationPermission(null), "unknown");
  assert.equal(modificationPermission({}), "unknown");
  assert.equal(modificationPermission({ license: "CC BY 4.0" }), "unknown");
  assert.equal(modificationPermission({ licence_permits_modification: true }), "permitted");
  assert.equal(modificationPermission({ licence_permits_modification: false }), "forbidden");
  assert.equal(modificationPermission({ license: "CC BY-ND 4.0", licence_permits_modification: true }), "forbidden");
});

test("owning our own work implies permission only when no external licence is also claimed", () => {
  assert.equal(modificationPermission({ owned: true, source_type: "staff_photograph" }), "permitted");
  // Contradictory row: owned outright AND used under someone's terms. Do not guess.
  assert.equal(
    modificationPermission({ owned: true, source_type: "staff_photograph", license: "CC BY 4.0" }),
    "unknown"
  );
  // Ownership alone, without a staff credit, leaves the copyright open.
  assert.equal(modificationPermission({ owned: true, source_type: "stock_licensed" }), "unknown");
});

// ---------------------------------------------------------------------------
// The safety property, stated directly
// ---------------------------------------------------------------------------

test("watermarking is a strict subset of publishability — nothing markable is unpublishable", () => {
  const cases: DerivativeAsset[] = [
    OWNED_PHOTO,
    withField({ rights_status: "unknown" }),
    withField({ rights_status: "pending_verification" }),
    withField({ asset_role: "article_hero", rights_status: "unknown" }),
    withField({ license: "CC BY-SA 4.0", licence_permits_modification: true }),
  ];
  for (const asset of cases) {
    if (!shouldWatermark(asset).watermark) continue;
    const eligibility = evaluatePublishEligibility({
      rights_status: asset.rights_status as never,
      owned: asset.owned ?? false,
      source_type: asset.source_type as never,
    });
    assert.equal(eligibility.allowed, true, "a watermarkable asset must also be publishable");
  }
});

test("no refusal path can be turned into permission by adding fields", () => {
  // Piling every "positive" field onto a chart, a logo and a press photo must
  // still refuse all three.
  const everything = {
    rights_status: "verified",
    owned: true,
    ai_generated: false,
    attribution_required: false,
    licence_permits_modification: true,
    media_type: "image",
    width: 4000,
    height: 3000,
  } as const;
  refuses({ ...everything, asset_role: "chart", source_type: "staff_photograph" }, "information_graphic");
  refuses({ ...everything, asset_role: "logo_brand", source_type: "staff_photograph" }, "brand_asset");
  refuses({ ...everything, asset_role: "product_photo", source_type: "press_kit" }, "press_kit");
  refuses({ ...everything, asset_role: "screenshot", source_type: "staff_photograph" }, "screenshot");
});

// ---------------------------------------------------------------------------
// Master invariant
// ---------------------------------------------------------------------------

test("a master is typed and constructed as unwatermarked and untransformed", () => {
  const master = masterOutput("image/abc.jpg");
  assert.equal(master.watermarked, false);
  assert.equal(master.transform, "none");
  assert.equal(master.retained, true);
  assert.equal(master.bucket, "media-private");
});

test("every plan retains the master as its first step", () => {
  const outputs = planDerivatives("asset-1", OWNED_PHOTO.storage_path!, OWNED_PHOTO);
  assert.equal(outputs[0].kind, "master");
  assert.equal(outputs.filter((o) => o.kind === "master").length, 1);
});

test("no derivative is ever written to the master's path", () => {
  const outputs = planDerivatives("asset-1", OWNED_PHOTO.storage_path!, OWNED_PHOTO);
  for (const output of outputs.slice(1)) {
    assert.notEqual(output.path, OWNED_PHOTO.storage_path);
    assert.ok(output.path.startsWith(DERIVATIVE_PATH_PREFIX));
  }
});

test("assertMasterRetained rejects a plan with no master", () => {
  const derivative: DerivativeOutput = {
    kind: "derivative",
    crop: "natural",
    width: 640,
    height: 480,
    format: "webp",
    watermarked: false,
    path: derivativePath("a", "natural", 640, "webp"),
    bucket: "media-private",
  };
  assert.throws(() => assertMasterRetained([derivative], "image/abc.jpg"), /exactly one master/);
});

test("assertMasterRetained rejects a master that is not first", () => {
  const derivative: DerivativeOutput = {
    kind: "derivative",
    crop: "natural",
    width: 640,
    height: 480,
    format: "webp",
    watermarked: false,
    path: derivativePath("a", "natural", 640, "webp"),
    bucket: "media-private",
  };
  assert.throws(
    () => assertMasterRetained([derivative, masterOutput("image/abc.jpg")], "image/abc.jpg"),
    /must be the first step/
  );
});

test("assertMasterRetained rejects a derivative written over the master", () => {
  const overwrite = {
    kind: "derivative",
    crop: "natural",
    width: 4000,
    height: 3000,
    format: "jpeg",
    watermarked: true,
    path: "image/abc.jpg",
    bucket: "media-private",
  } as DerivativeOutput;
  assert.throws(
    () => assertMasterRetained([masterOutput("image/abc.jpg"), overwrite], "image/abc.jpg"),
    /outside 'derivatives\/'/
  );
});

test("assertMasterRetained rejects a hand-built master claiming to be watermarked", () => {
  const lying = {
    kind: "master",
    retained: true,
    watermarked: true,
    transform: "watermark",
    path: "image/abc.jpg",
    bucket: "media-private",
  } as unknown as PipelineOutput;
  assert.throws(() => assertMasterRetained([lying], "image/abc.jpg"), /never be watermarked/);
});

test("assertMasterRetained rejects a master whose path is not the asset's storage_path", () => {
  assert.throws(
    () => assertMasterRetained([masterOutput("image/other.jpg")], "image/abc.jpg"),
    /does not match the asset's storage_path/
  );
});

// ---------------------------------------------------------------------------
// Widths, formats, crops
// ---------------------------------------------------------------------------

test("the responsive ladder never upscales", () => {
  assert.deepEqual(widthsForCrop("natural", { width: 1300, height: 900 }), [640, 828, 1080, 1200]);
  assert.deepEqual(widthsForCrop("natural", { width: 4203, height: 3152 }), [...RESPONSIVE_WIDTHS]);
});

test("a source narrower than the smallest rung still gets one derivative at its own size", () => {
  assert.deepEqual(widthsForCrop("natural", { width: 500, height: 400 }), [500]);
});

test("unrecorded dimensions produce no derivatives at all — a guess would be an upscale", () => {
  assert.deepEqual(widthsForCrop("natural", { width: null, height: null }), []);
  assert.deepEqual(widthsForCrop("natural", { width: 0, height: 0 }), []);
  assert.deepEqual(widthsForCrop("square", { width: 4000, height: null }), []);
  assert.deepEqual(widthsForCrop("og", {}), []);
});

test("the square crop is limited by the SHORT side, not the width", () => {
  // A 4000x200 panorama can only cut a 200px square.
  assert.deepEqual(widthsForCrop("square", { width: 4000, height: 200 }), [128]);
  assert.deepEqual(widthsForCrop("square", { width: 4000, height: 3000 }), [...THUMBNAIL_WIDTHS]);
});

test("the og crop needs enough of both dimensions", () => {
  assert.deepEqual(widthsForCrop("og", { width: 1600, height: 900 }), [OG_WIDTH]);
  assert.deepEqual(widthsForCrop("og", { width: 1000, height: 900 }), []);
  assert.deepEqual(widthsForCrop("og", { width: 1600, height: 400 }), []);
});

test("crop heights follow the crop's ratio, or the source's for a natural crop", () => {
  assert.equal(heightForCrop("square", 256, { width: 4000, height: 3000 }), 256);
  assert.equal(heightForCrop("og", OG_WIDTH, { width: 4000, height: 3000 }), OG_HEIGHT);
  assert.equal(heightForCrop("natural", 1200, { width: 4000, height: 3000 }), 900);
  assert.equal(heightForCrop("natural", 1200, { width: null, height: null }), null);
});

test("charts, logos, icons, screenshots and og assets are never cropped", () => {
  for (const role of ["diagram", "chart", "comparison_graphic", "logo_brand", "icon", "screenshot", "social_og"]) {
    assert.equal(isCroppable(role), false, role);
    assert.deepEqual(cropsForRole(role), ["natural"], role);
  }
});

test("an unrecorded role gets the natural crop only", () => {
  assert.equal(isCroppable(null), false);
  assert.deepEqual(cropsForRole(null), ["natural"]);
  assert.deepEqual(cropsForRole(undefined), ["natural"]);
});

test("a product photo gets natural, square and og", () => {
  assert.deepEqual(cropsForRole("product_photo"), ["natural", "square", "og"]);
});

test("lead images get natural and og; banners and backgrounds get natural only", () => {
  for (const role of ["article_hero", "category_hero", "homepage_feature"]) {
    assert.deepEqual(cropsForRole(role), ["natural", "og"], role);
  }
  assert.deepEqual(cropsForRole("banner"), ["natural"]);
  assert.deepEqual(cropsForRole("background"), ["natural"]);
});

test("formats are AVIF then WebP then a fallback, in next.config serving order", () => {
  assert.deepEqual(formatsFor(OWNED_PHOTO), [...MODERN_FORMATS, "jpeg"]);
  assert.deepEqual(fallbackFormat(OWNED_PHOTO), "jpeg");
});

test("flat-colour and transparent assets fall back to PNG, not JPEG", () => {
  assert.equal(fallbackFormat(withField({ asset_role: "chart" })), "png");
  assert.equal(fallbackFormat(withField({ asset_role: "logo_brand" })), "png");
  assert.equal(fallbackFormat(withField({ asset_role: "screenshot" })), "png");
  assert.equal(fallbackFormat(withField({ source_type: "tc_graphic" })), "png");
  assert.equal(fallbackFormat(withField({ brand_role: "mark" })), "png");
  assert.equal(fallbackFormat(null), "png");
});

// ---------------------------------------------------------------------------
// planDerivatives: which outputs carry the mark
// ---------------------------------------------------------------------------

test("a watermarkable asset marks only derivatives at or above the legibility floor", () => {
  const outputs = planDerivatives("asset-1", OWNED_PHOTO.storage_path!, OWNED_PHOTO);
  for (const output of outputs) {
    if (output.kind === "master") {
      assert.equal(output.watermarked, false);
      continue;
    }
    assert.equal(
      output.watermarked,
      output.width >= MIN_WATERMARK_WIDTH,
      `${output.crop}@${output.width} watermark flag`
    );
  }
  // And the small square thumbnails specifically are unmarked.
  const thumbs = outputs.filter((o) => o.kind === "derivative" && o.crop === "square");
  assert.ok(thumbs.length > 0);
  assert.ok(thumbs.every((t) => t.kind === "derivative" && t.watermarked === false));
});

test("a refused asset produces derivatives with no watermark anywhere", () => {
  const chart: DerivativeAsset = withField({ asset_role: "chart", source_type: "tc_graphic", width: 1600, height: 900 });
  const outputs = planDerivatives("asset-2", "image/abc-chart-x.png", chart);
  assert.ok(outputs.length > 1, "a chart still gets responsive derivatives — it just gets no mark");
  assert.ok(outputs.every((o) => o.watermarked === false));
});

test("a press-kit photograph gets its full derivative set and no mark", () => {
  const press = withField({ source_type: "press_kit", owned: false, rights_status: "verified" });
  const outputs = planDerivatives("asset-3", "image/abc-press.jpg", press);
  assert.ok(outputs.filter((o) => o.kind === "derivative").length > 0);
  assert.ok(outputs.every((o) => o.watermarked === false));
});

test("an asset with unrecorded dimensions yields the master and nothing else", () => {
  const outputs = planDerivatives("asset-4", "image/abc.jpg", withField({ width: null, height: null }));
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].kind, "master");
});

test("derivative paths are unique and namespaced by asset, crop, width and format", () => {
  const outputs = planDerivatives("asset-5", OWNED_PHOTO.storage_path!, OWNED_PHOTO);
  const paths = outputs.map((o) => o.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.slice(1).every((p) => p.startsWith("derivatives/asset-5/")));
});

test("every derivative stays in the private bucket — planning never publishes", () => {
  const outputs = planDerivatives("asset-6", OWNED_PHOTO.storage_path!, OWNED_PHOTO);
  assert.ok(outputs.every((o) => o.bucket === "media-private"));
});
