// What happens to an uploaded photograph, in order.
//
// WHY A PLAN RATHER THAN A FUNCTION THAT DOES IT
// ----------------------------------------------
// The steps below span three systems — Storage, `media_assets`/`media_derivatives`,
// and the product/content association tables — and the ordering between them is
// the part that is easy to get wrong and expensive to get wrong. Producing the
// order as DATA means it can be asserted in a unit test, shown to an admin
// before anything runs, and replayed after a partial failure, none of which is
// true of an ordering that only exists as the sequence of lines in an async
// function.
//
// THE THREE RULES THIS ENCODES
// ----------------------------
// 1. THE MASTER IS RETAINED FIRST AND NEVER TOUCHED. Step 0 is always the
//    master, and derivatives.ts types it as unwatermarked and untransformed.
//    Everything else is derived from it.
//
// 2. NOTHING BECOMES PUBLIC HERE. Every step writes to `media-private`. Upload
//    has never made anything public on this site and this does not change that:
//    publication remains a separate, explicit, rights-gated action. The plan
//    reports what `evaluatePublishEligibility()` would say, and reporting is
//    all it does.
//
// 3. AN UPLOAD WITHOUT A DESTINATION IS FLAGGED. Media handled "later" is the
//    failure the media-first publishing rule exists to prevent, so an upload
//    with no product or article to attach to produces a warning rather than
//    quietly landing in the library.
//
// Pure. No I/O.

import type { MediaRole, MediaRightsStatus, MediaSourceType } from "@/lib/types/database";
import {
  planDerivatives,
  shouldWatermark,
  assertMasterRetained,
  widthsForCrop,
  cropsForRole,
  MIN_WATERMARK_WIDTH,
  type DerivativeAsset,
  type PipelineOutput,
  type MasterOutput,
  type DerivativeOutput,
  type WatermarkDecision,
} from "./derivatives.ts";
import { evaluatePublishEligibility } from "./rights.ts";

export type EntityAssociation = {
  /** Which join table the row belongs in: `product_media` or `content_media`. */
  entity: "product" | "content";
  entityId: string;
  /** hero | gallery | thumbnail — the existing MediaRole vocabulary. */
  role: MediaRole;
};

export type UploadPlanInput = {
  /** The `media_assets.id` the row was inserted with. */
  assetId: string;
  /** `media_assets.storage_path` — the private master. */
  masterPath: string;
  asset: DerivativeAsset;
  /** Where this image is going. Null is allowed, and warned about. */
  association?: EntityAssociation | null;
};

export type PlanStepAction =
  | "retain_master"
  | "encode_derivative"
  | "watermark_derivative"
  | "associate_entity"
  | "await_publication";

export type PlanStep = {
  readonly order: number;
  readonly action: PlanStepAction;
  readonly description: string;
  /** The object this step produces, for the two steps that produce one. */
  readonly output: PipelineOutput | null;
  /**
   * Whether `publishMediaAsset()` should copy this object into `media-public`.
   *
   * FALSE FOR THE MASTER, ALWAYS. If the master were published, a watermarked
   * derivative set would be pointless — the unmarked full-resolution original
   * would be sitting one URL away. It is also the largest file we hold (the
   * library's biggest source is 9.9 MB) and no layout renders it at native
   * size.
   */
  readonly publishTarget: boolean;
};

export type PublicationReport = {
  /** What evaluatePublishEligibility() says today. Reported, never acted on. */
  readonly eligible: boolean;
  readonly reason: string;
};

export type UploadPlan = {
  readonly assetId: string;
  readonly master: MasterOutput;
  readonly derivatives: readonly DerivativeOutput[];
  readonly steps: readonly PlanStep[];
  readonly watermark: WatermarkDecision;
  readonly association: EntityAssociation | null;
  readonly publication: PublicationReport;
  /** Things a human should look at. Empty is a real answer. */
  readonly warnings: readonly string[];
};

/**
 * Build the ordered plan for one uploaded asset.
 *
 * Throws if the master invariant is violated. That is deliberate: a plan that
 * would overwrite or omit the original is not a plan to fix up, it is a bug,
 * and returning it with a warning attached would let a caller run it.
 */
export function buildUploadPlan(input: UploadPlanInput): UploadPlan {
  const { assetId, masterPath, asset } = input;
  const association = input.association ?? null;

  const outputs = planDerivatives(assetId, masterPath, asset);
  assertMasterRetained(outputs, masterPath);

  const master = outputs[0] as MasterOutput;
  const derivatives = outputs.filter((o): o is DerivativeOutput => o.kind === "derivative");
  const watermark = shouldWatermark(asset);

  const steps: PlanStep[] = [];
  let order = 0;

  steps.push({
    order: order++,
    action: "retain_master",
    description:
      `Retain the uploaded original at '${masterPath}' in media-private, unmodified. ` +
      "It is the archive and evidence record; every derivative below is read from it and none is written over it.",
    output: master,
    publishTarget: false,
  });

  for (const derivative of derivatives) {
    steps.push({
      order: order++,
      action: derivative.watermarked ? "watermark_derivative" : "encode_derivative",
      description:
        `${derivative.crop} crop at ${derivative.width}px` +
        (derivative.height ? `x${derivative.height}` : "") +
        ` as ${derivative.format}` +
        (derivative.watermarked ? ", watermarked" : "") +
        ` -> ${derivative.path} (media-private).`,
      output: derivative,
      // Derivatives are what a published asset should serve. The copy itself
      // still only happens inside the rights-gated publish action.
      publishTarget: true,
    });
  }

  if (association) {
    steps.push({
      order: order++,
      action: "associate_entity",
      description:
        `Insert into ${association.entity}_media: ${association.entity}_id=${association.entityId}, ` +
        `media_id=${assetId}, role='${association.role}'.`,
      output: null,
      publishTarget: false,
    });
  }

  steps.push({
    order: order++,
    action: "await_publication",
    description:
      "Stop. Nothing above is public. Publication is a separate admin action, gated by " +
      "evaluatePublishEligibility(), which copies the publish-target derivatives into media-public.",
    output: null,
    publishTarget: false,
  });

  return {
    assetId,
    master,
    derivatives,
    steps,
    watermark,
    association,
    publication: publicationReport(asset),
    warnings: collectWarnings(input, derivatives, watermark),
  };
}

function publicationReport(asset: DerivativeAsset): PublicationReport {
  // DerivativeAsset widens these to `| string` so a hand-built or partially
  // selected row can be passed in; the casts narrow them back to the unions
  // they came from. evaluatePublishEligibility is called UNCHANGED and its
  // answer is passed through verbatim — nothing here relaxes it, and an
  // unrecognised value simply fails its equality checks and stays blocked.
  const eligibility = evaluatePublishEligibility({
    rights_status: (asset.rights_status ?? undefined) as MediaRightsStatus | undefined,
    owned: asset.owned ?? false,
    source_type: (asset.source_type ?? null) as MediaSourceType | null,
  });
  return eligibility.allowed
    ? { eligible: true, reason: "Rights check passes. Publication is still a separate, deliberate action." }
    : { eligible: false, reason: eligibility.reason };
}

function collectWarnings(
  input: UploadPlanInput,
  derivatives: readonly DerivativeOutput[],
  watermark: WatermarkDecision
): string[] {
  const warnings: string[] = [];
  const { asset } = input;

  if (!input.association) {
    warnings.push(
      "No product or article association. Under the media-first publishing rule this is handled in the same workflow as the upload, not filled in later — an unattached asset is one nothing on the site can use."
    );
  }

  if (!asset.width || !asset.height) {
    warnings.push(
      "Width and/or height are not recorded, so no responsive derivative can be planned without risking an upscale. Record the source dimensions on the media_assets row first."
    );
  }

  if (derivatives.length === 0) {
    warnings.push(
      "This plan produces no derivatives at all — the master is retained and nothing else. Check the recorded dimensions and asset role."
    );
  }

  if (!asset.asset_role) {
    warnings.push(
      "No asset role is recorded. The plan falls back to the natural crop only, and watermarking is refused, because nothing distinguishes a photograph from a diagram."
    );
  }

  if (watermark.watermark) {
    const marked = derivatives.filter((d) => d.watermarked).length;
    warnings.push(
      `This asset is watermarked on ${marked} of ${derivatives.length} derivatives (those at or above ${MIN_WATERMARK_WIDTH}px). ` +
        "publishMediaAsset() currently copies the MASTER into media-public, which would put the unmarked original online. " +
        "That action must be switched to the publish-target derivatives before watermarking is turned on for real."
    );
  }

  // Cheap consistency check against the crop layer: a role that asks for a
  // crop the source is too small to cut is worth saying out loud, since the
  // silent result is simply a missing size.
  for (const crop of cropsForRole(asset.asset_role)) {
    if (crop === "natural") continue;
    if (widthsForCrop(crop, { width: asset.width, height: asset.height }).length === 0) {
      warnings.push(
        `The '${crop}' crop was skipped: the source is too small (or its dimensions are unrecorded) to cut it without upscaling.`
      );
    }
  }

  return warnings;
}
