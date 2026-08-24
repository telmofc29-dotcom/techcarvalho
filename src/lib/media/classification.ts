// What kind of media is this, honestly?
//
// WHY A DERIVED CLASSIFICATION RATHER THAN A NEW COLUMN
// -----------------------------------------------------
// The library already stores source_type, asset_role, brand_role, owned,
// ai_generated and rights_status. Between them they carry everything needed to
// say what an asset IS. Adding a `classification` column would create a second
// source of truth that can disagree with the first — and the first is what the
// rights gate, the watermark gate and the publish gate all read.
//
// So the classification is COMPUTED. It cannot drift from the fields that
// govern behaviour, because it is those fields.
//
// THE ONE THING THAT NEEDED NEW STORAGE
// -------------------------------------
// A concept render. `ai_generated` says an image was machine-made; it does not
// say the image DEPICTS SOMETHING THAT DOES NOT EXIST. An AI-upscaled photo of
// a real camera and an imagined PlayStation 6 are both ai_generated and are not
// remotely the same claim. That distinction needs a value of its own, so
// asset_role gains `concept_render`.
//
// THE INVARIANT THIS FILE EXISTS FOR
// ----------------------------------
// A concept render must never be presentable as the product. Not in a product
// gallery, not as a hero that implies documentation, not in structured data,
// not as evidence for a specification. `isDepictionOfRealProduct()` returns
// false for it, and a public disclosure is REQUIRED and derived rather than
// typed — a caption someone has to remember to write is a caption that will one
// day be missing.
//
// Pure. No I/O.

export type MediaClassification =
  /** Our own camera. No external licence, no attribution owed. */
  | "owned_original_photo"
  /** Somebody else's photograph, with reuse rights established. */
  | "third_party_rights_verified_photo"
  /** Manufacturer press/official media whose terms we have checked. */
  | "official_rights_verified_media"
  /** A photograph whose rights are NOT established. Unusable until they are. */
  | "unverified_photo"
  /** Our own illustrative graphic — title cards, editorial art. */
  | "generated_editorial"
  /** Machine-made imagery of something that does not exist or is unrevealed. */
  | "generated_concept"
  /** A chart or plot carrying data. */
  | "data_graphic"
  /** An explanatory diagram. */
  | "diagram"
  /** A side-by-side comparison graphic. */
  | "comparison_graphic"
  /** A logo, wordmark or icon. Somebody's trademark. */
  | "logo_brand"
  /** A screen capture. */
  | "screenshot"
  /** Nothing above fits. */
  | "unclassified";

export type ClassifiableMedia = {
  source_type?: string | null;
  asset_role?: string | null;
  brand_role?: string | null;
  owned?: boolean | null;
  ai_generated?: boolean | null;
  rights_status?: string | null;
};

const THIRD_PARTY_SOURCES = new Set(["stock_licensed", "public_domain_or_cc", "user_submitted"]);
const OFFICIAL_SOURCES = new Set(["manufacturer", "press_kit"]);

/**
 * Classify an asset.
 *
 * Order matters and is a correctness order, not a preference. Brand marks and
 * concept renders are decided FIRST, because both carry constraints that
 * nothing later may override: a logo must never be watermarked, and a concept
 * render must never read as documentation.
 */
export function classifyMedia(asset: ClassifiableMedia | null | undefined): MediaClassification {
  if (!asset) return "unclassified";

  const role = asset.asset_role ?? "";
  const source = asset.source_type ?? "";

  // A trademark, whatever else it is.
  if (asset.brand_role || role === "logo_brand" || role === "icon") return "logo_brand";

  // An imagined thing. Decided before anything about ownership or rights,
  // because owning a concept render does not make it a photograph.
  if (role === "concept_render") return "generated_concept";

  if (role === "screenshot") return "screenshot";
  if (role === "chart") return "data_graphic";
  if (role === "diagram") return "diagram";
  if (role === "comparison_graphic") return "comparison_graphic";

  if (source === "tc_graphic") {
    // A machine-made editorial graphic is still editorial: it illustrates, it
    // does not claim to show a real object.
    return "generated_editorial";
  }

  if (source === "staff_photograph") return "owned_original_photo";

  const verified = asset.rights_status === "verified";
  if (OFFICIAL_SOURCES.has(source)) {
    return verified ? "official_rights_verified_media" : "unverified_photo";
  }
  if (THIRD_PARTY_SOURCES.has(source)) {
    return verified ? "third_party_rights_verified_photo" : "unverified_photo";
  }

  return "unclassified";
}

/**
 * Does this asset depict a REAL product as it actually is?
 *
 * The question every product page, gallery and structured-data emitter should
 * ask before showing an image as the product. A concept render answers no, and
 * so does a diagram, a logo and a screenshot — none of them is a photograph of
 * the object.
 */
export function isDepictionOfRealProduct(asset: ClassifiableMedia | null | undefined): boolean {
  const c = classifyMedia(asset);
  return (
    c === "owned_original_photo" ||
    c === "third_party_rights_verified_photo" ||
    c === "official_rights_verified_media"
  );
}

/** May this asset be cited as evidence for a factual claim about a product? */
export function isUsableAsEvidence(asset: ClassifiableMedia | null | undefined): boolean {
  const c = classifyMedia(asset);
  // A concept render is imagination. A generated editorial graphic illustrates
  // rather than records. Neither documents anything about real hardware.
  return c !== "generated_concept" && c !== "generated_editorial" && c !== "unclassified";
}

/**
 * The public disclosure this asset MUST carry, or null when none is needed.
 *
 * Derived, never typed. A disclosure an editor has to remember to write is one
 * that will eventually be forgotten on the page where it mattered most, and the
 * whole point is that a reader is never misled about whether they are looking
 * at a real product.
 */
export function requiredDisclosure(asset: ClassifiableMedia | null | undefined): string | null {
  switch (classifyMedia(asset)) {
    case "generated_concept":
      return "Concept render — not official product imagery. The actual hardware has not been revealed.";
    case "generated_editorial":
      return asset?.ai_generated
        ? "Illustration — AI-generated editorial artwork, not a photograph."
        : null;

    // A MACHINE-MADE IMAGE WE CANNOT OTHERWISE CLASSIFY STILL HAS TO SAY SO.
    //
    // classifyMedia() returns 'unclassified' when source_type was never set,
    // which is the normal state of a fresh upload. Until this case existed, an
    // asset with ai_generated = true disclosed NOTHING whenever that one field
    // happened to be blank — and two AI renders of unreleased hardware went
    // live on articles that way, silently, while two sibling uploads that did
    // carry a source_type disclosed correctly. The difference between
    // disclosing and not disclosing must never be an unrelated blank field.
    //
    // Deliberately NOT applied to the photograph classifications above. An
    // AI-upscaled photograph of real hardware is ai_generated = true and IS a
    // photograph; telling a reader it is not would be its own falsehood.
    // 'unclassified' carries no such claim, so the minimal true statement is
    // that a machine made it.
    case "unclassified":
      return asset?.ai_generated === true ? "AI-generated image — not a photograph." : null;

    default:
      return null;
  }
}

/** Human labels for the admin. */
export const CLASSIFICATION_LABEL: Record<MediaClassification, string> = {
  owned_original_photo: "Our photograph",
  third_party_rights_verified_photo: "Licensed photograph",
  official_rights_verified_media: "Official media",
  unverified_photo: "Photograph — rights not established",
  generated_editorial: "Editorial graphic",
  generated_concept: "Concept render",
  data_graphic: "Data graphic",
  diagram: "Diagram",
  comparison_graphic: "Comparison graphic",
  logo_brand: "Logo / brand mark",
  screenshot: "Screenshot",
  unclassified: "Unclassified",
};

/**
 * Asset roles that assert the image shows a real product.
 *
 * Used to REFUSE a save that would turn a concept render into product
 * photography — the specific mistake that would put an imagined PlayStation 6
 * on the PS5 product page as though it were a photograph.
 */
const REAL_PRODUCT_ROLES = new Set(["product_photo"]);

export type RoleConflict = { allowed: false; reason: string } | { allowed: true };

/**
 * May this asset take this editorial role?
 *
 * Enforced server-side on save. The UI can also prevent it, but the UI is not
 * the boundary.
 */
export function canTakeRole(asset: ClassifiableMedia, role: string): RoleConflict {
  const wouldBe = classifyMedia({ ...asset, asset_role: role });
  const isConcept = asset.asset_role === "concept_render" || asset.ai_generated === true;

  if (REAL_PRODUCT_ROLES.has(role) && isConcept && wouldBe !== "generated_concept") {
    return {
      allowed: false,
      reason:
        "An AI-generated or concept image cannot be a product photograph. Keep the role as " +
        "'concept_render' so the page discloses what it is.",
    };
  }
  return { allowed: true };
}
