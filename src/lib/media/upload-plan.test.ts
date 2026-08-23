import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUploadPlan, type UploadPlanInput } from "./upload-plan.ts";
import { MIN_WATERMARK_WIDTH, type DerivativeAsset } from "./derivatives.ts";

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

function plan(overrides: Partial<UploadPlanInput> = {}) {
  return buildUploadPlan({
    assetId: "asset-1",
    masterPath: "image/abc-canon-r6.jpg",
    asset: OWNED_PHOTO,
    association: { entity: "product", entityId: "product-1", role: "hero" },
    ...overrides,
  });
}

test("step 0 is always retaining the master, unmodified and not a publish target", () => {
  const p = plan();
  assert.equal(p.steps[0].order, 0);
  assert.equal(p.steps[0].action, "retain_master");
  assert.equal(p.steps[0].publishTarget, false);
  assert.equal(p.master.watermarked, false);
  assert.equal(p.master.transform, "none");
});

test("the last step is a stop, not a publish", () => {
  const p = plan();
  assert.equal(p.steps[p.steps.length - 1].action, "await_publication");
  assert.ok(p.steps.every((s) => s.output === null || s.output.bucket === "media-private"));
});

test("steps are numbered consecutively from zero", () => {
  const p = plan();
  p.steps.forEach((step, i) => assert.equal(step.order, i));
});

test("watermarked derivatives are marked as such in the step action", () => {
  const p = plan();
  for (const step of p.steps) {
    if (step.output?.kind !== "derivative") continue;
    assert.equal(
      step.action,
      step.output.watermarked ? "watermark_derivative" : "encode_derivative"
    );
    assert.equal(step.output.watermarked, step.output.width >= MIN_WATERMARK_WIDTH);
  }
});

test("a press-kit photograph plans the same derivatives with no watermark step", () => {
  const p = plan({
    asset: { ...OWNED_PHOTO, source_type: "press_kit", owned: false },
  });
  assert.equal(p.watermark.watermark, false);
  assert.ok(p.derivatives.length > 0);
  assert.ok(p.steps.every((s) => s.action !== "watermark_derivative"));
});

test("the association step names the right join table and role", () => {
  const p = plan({ association: { entity: "content", entityId: "article-9", role: "gallery" } });
  const step = p.steps.find((s) => s.action === "associate_entity");
  assert.ok(step);
  assert.match(step.description, /content_media/);
  assert.match(step.description, /article-9/);
  assert.match(step.description, /'gallery'/);
});

test("an upload with no association is warned about, per the media-first rule", () => {
  const p = plan({ association: null });
  assert.equal(p.association, null);
  assert.ok(p.steps.every((s) => s.action !== "associate_entity"));
  assert.ok(p.warnings.some((w) => /media-first/i.test(w)));
});

test("publication eligibility is reported, never acted on", () => {
  assert.equal(plan().publication.eligible, true);
  const blocked = plan({
    asset: { ...OWNED_PHOTO, source_type: "manufacturer", owned: false, rights_status: "unknown" },
  });
  assert.equal(blocked.publication.eligible, false);
  assert.match(blocked.publication.reason, /rights/i);
  // Reporting "not eligible" must not stop the derivative plan from existing —
  // derivatives are private work product, publication is a separate question.
  assert.ok(blocked.derivatives.length > 0);
});

test("a restricted asset is blocked from publication and gets no watermark", () => {
  const p = plan({ asset: { ...OWNED_PHOTO, rights_status: "restricted" } });
  assert.equal(p.publication.eligible, false);
  assert.equal(p.watermark.watermark, false);
  assert.ok(p.derivatives.every((d) => !d.watermarked));
});

test("an asset with unrecorded dimensions produces the master, a stop, and warnings", () => {
  const p = plan({ asset: { ...OWNED_PHOTO, width: null, height: null } });
  assert.equal(p.derivatives.length, 0);
  assert.ok(p.warnings.some((w) => /Width and\/or height are not recorded/.test(w)));
  assert.ok(p.warnings.some((w) => /no derivatives at all/.test(w)));
});

test("a watermarked plan warns that publishMediaAsset still copies the unmarked master", () => {
  const p = plan();
  assert.equal(p.watermark.watermark, true);
  assert.ok(p.warnings.some((w) => /publishMediaAsset/.test(w)));
});

test("a skipped crop is reported rather than silently missing", () => {
  // 1000px wide: too narrow for the 1200px OG cut.
  const p = plan({ asset: { ...OWNED_PHOTO, width: 1000, height: 800 } });
  assert.ok(p.derivatives.every((d) => d.crop !== "og"));
  assert.ok(p.warnings.some((w) => /'og' crop was skipped/.test(w)));
});

test("no planned output ever writes over the master", () => {
  const p = plan();
  assert.equal(p.master.path, "image/abc-canon-r6.jpg");
  for (const derivative of p.derivatives) {
    assert.notEqual(derivative.path, p.master.path);
    assert.ok(derivative.path.startsWith("derivatives/asset-1/"));
  }
});
