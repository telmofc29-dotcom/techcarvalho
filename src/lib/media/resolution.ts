// What image SHOULD this page have, and can we actually get it?
//
// WHY THIS EXISTS
// ---------------
// photo-requests.ts answers "which photograph would improve the most pages".
// That is a question about the SITE. It is not the same question as "can the
// owner realistically take this photograph", which is a question about the
// WORLD, and conflating them produces a shooting list that looks actionable and
// is not: the top entry might be a £4,000 camera body nobody involved owns or
// can borrow, sitting above a router on the owner's own desk.
//
// A backlog whose top item cannot be done teaches its reader to skip the top
// item. So access is tracked separately and the two are only combined at the
// end, deliberately and visibly.
//
// THE SECOND THING THIS FIXES
// ---------------------------
// "Needs a photograph" is not the only honest outcome for a page with a weak
// image. There are six, and choosing between them is an editorial decision that
// was previously implicit in whoever happened to be doing the work:
//
//   owned_original              we shoot it ourselves
//   legally_reusable_photograph someone else's real photo we may lawfully use
//   rights_cleared_official     manufacturer press media, within its licence
//   original_illustration       we draw it, because no photo would explain it
//   data_graphic                a chart, because the subject IS the numbers
//   unresolved                  none of the above is available yet — say so
//
// The last one matters most. A page whose media question has no answer must be
// able to SAY that, rather than quietly receiving a generated title card that
// looks like a decision was made.
//
// AND THE THING IT REFUSES TO DO
// ------------------------------
// A data graphic is not a consolation prize. Where the subject genuinely is a
// set of numbers — install sizes, generational bandwidth, minimum versus
// recommended specs — a chart is the RIGHT lead image and a photograph of the
// box would be worse. resolveMediaStrategy will not recommend replacing one,
// and rankPhotoRequests already skips those products entirely.
//
// Pure. No I/O.

/**
 * Whether a photograph is physically obtainable by the people who run this
 * site.
 *
 * `unknown` is the default and means NOBODY HAS SAID. It is emphatically not a
 * synonym for `not_accessible`: this project has been bitten repeatedly by
 * unmeasured state being read as a finding, so an unknown product is offered
 * for triage rather than silently dropped from or promoted up the list.
 */
export type OwnerAccess =
  /** In the owner's possession now. */
  | "owned"
  /** Obtainable from someone known, for long enough to photograph. */
  | "borrowable"
  /** Photographable on display in a shop — limited angles, no studio control. */
  | "retail_display"
  /** Realistically not obtainable: discontinued, prohibitive, or never sold locally. */
  | "not_accessible"
  /** Nobody has assessed this yet. */
  | "unknown";

export type MediaResolution =
  | "owned_original"
  | "legally_reusable_photograph"
  | "rights_cleared_official"
  | "original_illustration"
  | "data_graphic"
  | "unresolved";

export type ResolutionInput = {
  /** True when the subject is inherently numeric and a chart explains it best. */
  subjectIsData: boolean;
  /**
   * True when the thing cannot usefully be photographed at all — a wireless
   * standard, a software feature, a licensing change. An illustration or
   * diagram is the honest answer, not a stock photo of a generic router.
   */
  subjectIsAbstract: boolean;
  /** Can we get at the physical object? */
  ownerAccess: OwnerAccess;
  /** A real photograph exists that we may lawfully reuse (CC, public domain). */
  reusablePhotographAvailable: boolean;
  /**
   * Manufacturer press-kit media exists AND its licence permits our use.
   * Both halves are required: existence is not permission.
   */
  officialMediaCleared: boolean;
};

export type ResolutionDecision = {
  resolution: MediaResolution;
  /** Plain-language reason, for an admin deciding what to do next. */
  reason: string;
  /** True when this outcome needs a person to act before the page improves. */
  needsAction: boolean;
};

/**
 * Decide how a page's media question should be answered.
 *
 * ORDER MATTERS and is not a preference ranking — it is a correctness ranking.
 * The two subject tests come FIRST, before any question about availability,
 * because a chart beats a photograph for a numeric subject even when a
 * photograph is freely available. Asking "what can we get" before "what does
 * this page need" is how a comparison article ends up leading with a product
 * shot instead of the comparison.
 */
export function resolveMediaStrategy(input: ResolutionInput): ResolutionDecision {
  if (input.subjectIsData) {
    return {
      resolution: "data_graphic",
      reason:
        "The subject is the numbers themselves, so a chart carries the point and a " +
        "photograph of the hardware would not. Not a fallback — the correct lead image.",
      needsAction: false,
    };
  }

  if (input.subjectIsAbstract) {
    return {
      resolution: "original_illustration",
      reason:
        "There is no object to photograph — the subject is a standard, a feature or a " +
        "change. An original diagram explains it; a stock photo of adjacent hardware " +
        "would only decorate it.",
      needsAction: true,
    };
  }

  // Owned photography first among the real-object options: it carries no
  // attribution obligation and no dependency on somebody else's licence
  // continuing to exist.
  if (input.ownerAccess === "owned" || input.ownerAccess === "borrowable") {
    return {
      resolution: "owned_original",
      reason:
        input.ownerAccess === "owned"
          ? "The object is to hand, so we can shoot it ourselves and own the result outright."
          : "The object can be borrowed, so we can shoot it ourselves and own the result outright.",
      needsAction: true,
    };
  }

  if (input.reusablePhotographAvailable) {
    return {
      resolution: "legally_reusable_photograph",
      reason:
        "A real photograph exists under a licence that permits our use. Weaker than an " +
        "owned original — it carries an attribution obligation — but it is a genuine " +
        "photograph of the actual product.",
      needsAction: true,
    };
  }

  if (input.officialMediaCleared) {
    return {
      resolution: "rights_cleared_official",
      reason:
        "Manufacturer press media is available and its licence covers this use. It is " +
        "the product as the maker presents it rather than as it looks in a room, so it " +
        "is preferred to nothing and not to an independent photograph.",
      needsAction: true,
    };
  }

  // Retail display is deliberately ranked BELOW licensed alternatives. A
  // handheld shot of a boxed product under shop lighting, behind glass, is
  // usually worse than cleared press media — but it is still a real photograph
  // of the real thing, so it beats being unresolved.
  if (input.ownerAccess === "retail_display") {
    return {
      resolution: "owned_original",
      reason:
        "Photographable on display in a shop. Expect constrained angles and lighting, " +
        "so treat this as a fallback to a studio shot rather than an equivalent.",
      needsAction: true,
    };
  }

  return {
    resolution: "unresolved",
    reason:
      input.ownerAccess === "unknown"
        ? "Nobody has assessed whether this can be photographed, and no reusable or " +
          "cleared image has been found. This needs a decision, not a placeholder."
        : "The object is not obtainable and no reusable or cleared image exists. The page " +
          "should say it has no image rather than show a generated card.",
    needsAction: true,
  };
}

/**
 * Whether a photo REQUEST should be issued to the owner.
 *
 * Separate from resolveMediaStrategy on purpose: the strategy says what the
 * page needs, this says whether asking a person to go and shoot it is a
 * reasonable thing to do. `unknown` returns true — an unassessed product is
 * worth putting in front of someone who can answer, and burying it would make
 * the backlog quietly incomplete.
 */
export function isShootable(access: OwnerAccess): boolean {
  return access !== "not_accessible";
}

/** Ordering for the shooting list: easiest and most controllable first. */
export const ACCESS_RANK: Record<OwnerAccess, number> = {
  owned: 0,
  borrowable: 1,
  retail_display: 2,
  unknown: 3,
  not_accessible: 4,
};

export const ACCESS_LABEL: Record<OwnerAccess, string> = {
  owned: "Owned",
  borrowable: "Can borrow",
  retail_display: "In shops",
  unknown: "Not assessed",
  not_accessible: "Cannot obtain",
};
