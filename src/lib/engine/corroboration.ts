// CORROBORATION — how many independent voices a claim actually needs.
//
// THE PROBLEM THIS FIXES
// ----------------------
// Production held 195 discoveries. Every one had exactly one evidence row from
// exactly one publisher, and zero had independent corroboration. The Phase C
// gate required two independent publishers, so nothing ever cleared it and the
// pipeline stalled with 0 approvals.
//
// The tempting fix — require one publisher instead of two — is the one thing
// that must not happen. But the honest diagnosis is not "the threshold is too
// high" either. It is that a SINGLE THRESHOLD FOR EVERY CLAIM IS WRONG.
//
// Look at what the 195 actually are. 148 are `confirmed_primary`, and the
// publishers are blog.google, mozilla.org, nvidia.com, home-assistant.io,
// raspberrypi.com, vesa.org. These are vendors announcing their own actions.
// "Mozilla shipped a VPN in Firefox", sourced to Mozilla, is not weak evidence
// waiting for corroboration — Mozilla is the ONLY body that can authoritatively
// state what Mozilla shipped. Demanding that The Verge confirm it before we
// believe Mozilla about Mozilla is not rigour; it is a category error.
//
// Now look at the other direction. "The iPhone 18 will have a 2nm chip",
// sourced to one site, is exactly the claim that needs corroboration — and it
// needs it MORE than the vendor announcement did, because the publisher has no
// authority over the fact and the subject has not confirmed it.
//
// So the requirement is a function of WHAT IS BEING CLAIMED and WHO IS
// CLAIMING IT, not a constant.
//
// WHAT THIS DOES NOT DO
// ---------------------
// It never lets repetition become corroboration. Five outlets repeating one
// leak is still one voice — that rule lives in independence.ts and is untouched
// here. It never converts a rumour into a fact. And first-party authority is
// strictly bounded: it establishes THAT AN ANNOUNCEMENT WAS MADE and what it
// said, never that the announcement's forward-looking or comparative claims are
// true. A vendor saying its GPU is "2x faster" is authoritative evidence that
// the vendor said so, and no evidence at all that it is.
//
// PURE. No `server-only`, no Supabase, no network.

import { hostOf, registrableDomain } from "./independence.ts";
import type { ClaimStatus } from "./types.ts";

// ---------------------------------------------------------------------------
// What kind of claim is this?
// ---------------------------------------------------------------------------

export type ClaimClass =
  /**
   * A party announcing its own action, sourced to that party.
   * "Mozilla shipped X", from mozilla.org. Self-authoritative for the fact of
   * the announcement and its contents.
   */
  | "first_party_announcement"
  /**
   * A claim about a third party, or a claim whose truth the publisher has no
   * authority over. Needs independent corroboration.
   */
  | "third_party_report"
  /**
   * Specifications, pricing or dates for something not yet released, from
   * anyone other than the maker. The highest-risk class on a tech site.
   */
  | "unreleased_product_claim"
  /** Explicitly a rumour or leak. Reportable only AS a rumour, never as fact. */
  | "rumour_or_leak";

export const CLAIM_CLASS_LABELS: Record<ClaimClass, string> = {
  first_party_announcement: "First-party announcement",
  third_party_report: "Third-party report",
  unreleased_product_claim: "Unreleased-product claim",
  rumour_or_leak: "Rumour or leak",
};

/**
 * Independent publishers required before a claim of this class may be asserted.
 *
 * A TOTAL record, so a new claim class cannot be added without deciding what it
 * costs. The numbers are editorial policy, stated once:
 *
 *   1  The source is the authority on the subject. More sources add nothing
 *      that the subject has not already settled.
 *   2  Nobody here is the authority, so agreement between independent voices
 *      is the only thing that raises confidence.
 *   3  Unreleased-product claims get the strictest bar because they are the
 *      ones a tech site is most often wrong about, and being wrong is most
 *      visible — the product eventually ships and contradicts you.
 *
 * `rumour_or_leak` is 1 deliberately, and it is NOT a weak bar: a rumour never
 * becomes assertable at any count. It is publishable only with rumour framing,
 * which `assertability` below enforces separately from this number.
 */
export const REQUIRED_INDEPENDENT_SOURCES: Record<ClaimClass, number> = {
  first_party_announcement: 1,
  third_party_report: 2,
  unreleased_product_claim: 3,
  rumour_or_leak: 1,
};

/**
 * How a claim of this class may be written, once corroborated.
 *
 * Separate from the count on purpose. Meeting the source requirement earns the
 * right to PUBLISH; it never earns the right to state something as fact. A
 * rumour corroborated by ten outlets is still a rumour.
 */
export type Assertability =
  /** May be stated as established fact. */
  | "assertable"
  /** Must be attributed: "Mozilla says…", "According to X…". */
  | "attributed"
  /** Must be explicitly framed as unconfirmed. */
  | "rumour_framed";

export const ASSERTABILITY: Record<ClaimClass, Assertability> = {
  // Authoritative about ITSELF: "Mozilla added a VPN" is assertable. What is
  // NOT assertable is the vendor's forward-looking or comparative claims, which
  // `boundedBy` below states out loud rather than leaving to judgement.
  first_party_announcement: "assertable",
  third_party_report: "attributed",
  unreleased_product_claim: "attributed",
  rumour_or_leak: "rumour_framed",
};

/** The limit of what first-party authority buys. Shown to the owner verbatim. */
export const FIRST_PARTY_BOUND =
  "Authoritative for what was announced and that it was announced. NOT authoritative for " +
  "performance claims, comparisons with competitors, or anything the announcement predicts. " +
  "A vendor calling its own product twice as fast is evidence that it said so, not that it is.";

// ---------------------------------------------------------------------------
// Classifying
// ---------------------------------------------------------------------------

export type CorroborationInput = {
  /** Evidence URLs recorded for the discovery. */
  sourceUrls: readonly string[];
  /**
   * Domains that ARE the subject of the claim — the manufacturer's own sites.
   * Supplied by the caller from the manufacturers registry, never guessed from
   * the title.
   */
  subjectDomains: readonly string[];
  /** The strongest claim status recorded on the discovery. */
  claimStatus: ClaimStatus;
  /** True when the subject product is not yet released. */
  aboutUnreleasedProduct: boolean;
};

export type CorroborationVerdict = {
  claimClass: ClaimClass;
  required: number;
  independentPublishers: number;
  /** Publishers that are the subject itself. */
  firstPartyPublishers: string[];
  /** Publishers independent of the subject. */
  independentDomains: string[];
  sufficient: boolean;
  assertability: Assertability;
  /** Ordered, human-readable. First entry is the primary reason. */
  reasons: string[];
  /** What is still needed, when insufficient. Empty when sufficient. */
  missing: string[];
};

/**
 * Classify what kind of claim this is.
 *
 * Order matters and runs strictest-first: a rumour about an unreleased product
 * is a rumour, and a leak sourced to the vendor's own domain is still a leak.
 * First-party authority is the LAST thing checked, so it can never launder a
 * claim that some stricter rule already caught.
 */
export function classifyClaim(input: CorroborationInput): ClaimClass {
  if (input.claimStatus === "rumour" || input.claimStatus === "leak") {
    return "rumour_or_leak";
  }
  if (input.aboutUnreleasedProduct && !isFirstParty(input)) {
    return "unreleased_product_claim";
  }
  if (isFirstParty(input)) {
    return "first_party_announcement";
  }
  return "third_party_report";
}

/**
 * Whether the claim is sourced to the subject's own domain.
 *
 * Requires that AT LEAST ONE source is the subject. It deliberately does not
 * require that ALL are: a vendor announcement picked up by two outlets is still
 * a first-party announcement, and is stronger for the pickup, not weaker.
 */
export function isFirstParty(input: CorroborationInput): boolean {
  const subject = new Set(input.subjectDomains.map((d) => d.toLowerCase()));
  if (subject.size === 0) return false;
  return domainsOf(input.sourceUrls).some((d) => subject.has(d));
}

/** Distinct registrable domains. `hostOf` first — see brief-quality.ts for why. */
export function domainsOf(urls: readonly string[]): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    const d = registrableDomain(hostOf(u));
    if (d) out.add(d.toLowerCase());
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

export function assessCorroboration(input: CorroborationInput): CorroborationVerdict {
  const claimClass = classifyClaim(input);
  const required = REQUIRED_INDEPENDENT_SOURCES[claimClass];
  const subject = new Set(input.subjectDomains.map((d) => d.toLowerCase()));
  const all = domainsOf(input.sourceUrls);

  const firstPartyPublishers = all.filter((d) => subject.has(d));
  const independentDomains = all.filter((d) => !subject.has(d));

  // For a first-party announcement the subject's own domain IS the qualifying
  // voice, so it counts toward the requirement. For every other class it does
  // not: a vendor cannot corroborate a claim about a vendor.
  const counted =
    claimClass === "first_party_announcement"
      ? all.length
      : independentDomains.length;

  const sufficient = counted >= required;
  const reasons: string[] = [];
  const missing: string[] = [];

  switch (claimClass) {
    case "first_party_announcement":
      reasons.push(
        `Announced by the subject itself (${firstPartyPublishers.join(", ")}), which is the ` +
          `authoritative source for its own actions.`
      );
      reasons.push(FIRST_PARTY_BOUND);
      if (independentDomains.length > 0) {
        reasons.push(
          `Also carried independently by ${independentDomains.join(", ")}, which corroborates the ` +
            `pickup but is not what makes it authoritative.`
        );
      }
      break;

    case "third_party_report":
      if (sufficient) {
        reasons.push(
          `${counted} independent publishers (${independentDomains.join(", ")}) and none is the ` +
            `subject, so agreement between them is meaningful.`
        );
      } else {
        reasons.push(
          `${counted} independent publisher${counted === 1 ? "" : "s"}; ${required} required. ` +
            `Nobody reporting this is the authority on it, so a single account cannot settle it.`
        );
        missing.push(`${required - counted} more independent publisher(s)`);
      }
      break;

    case "unreleased_product_claim":
      if (sufficient) {
        reasons.push(
          `${counted} independent publishers on an unreleased product, meeting the strictest bar.`
        );
      } else {
        reasons.push(
          `Claims about an unreleased product need ${required} independent publishers; ${counted} ` +
            `found. This is the class a technology site is most often wrong about, and the product ` +
            `eventually ships and contradicts you.`
        );
        missing.push(`${required - counted} more independent publisher(s)`);
      }
      reasons.push("Must stay attributed. The maker has not confirmed this.");
      break;

    case "rumour_or_leak":
      reasons.push(
        "Recorded as a rumour or leak. Publishable only with explicit unconfirmed framing, and " +
          "no number of repetitions makes it assertable."
      );
      if (independentDomains.length > 1) {
        reasons.push(
          `${independentDomains.length} outlets carry it, which is NOT corroboration if they are ` +
            `repeating one original report.`
        );
      }
      break;
  }

  return {
    claimClass,
    required,
    independentPublishers: independentDomains.length,
    firstPartyPublishers,
    independentDomains,
    sufficient,
    assertability: ASSERTABILITY[claimClass],
    reasons,
    missing,
  };
}

// ---------------------------------------------------------------------------
// Subject-domain resolution
// ---------------------------------------------------------------------------

/**
 * Build the domain set that counts as "the subject" for a manufacturer.
 *
 * Deliberately fed from RECORDED data — the manufacturer's website and the
 * registered engine_sources belonging to that organisation — rather than
 * inferred from a name. Inferring "apple.com" from the string "Apple" is the
 * kind of guess that silently grants first-party authority to a domain nobody
 * verified, which is exactly the wrong direction to be wrong in.
 */
export function subjectDomainsFor(input: {
  manufacturerWebsite?: string | null;
  sourceUrls?: readonly string[];
}): string[] {
  const out = new Set<string>();
  const site = registrableDomain(hostOf(input.manufacturerWebsite ?? null));
  if (site) out.add(site.toLowerCase());
  for (const u of input.sourceUrls ?? []) {
    const d = registrableDomain(hostOf(u));
    if (d) out.add(d.toLowerCase());
  }
  return [...out];
}
