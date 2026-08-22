// The provider registry.
//
// WHAT "APPROVED" MEANS HERE, ONE MORE TIME
// -----------------------------------------
// `approvedForSearch: true` means the engine may issue HTTP requests to this
// source. It says nothing whatsoever about any asset the source returns. Every
// candidate from an approved provider goes through the same pipeline as every
// candidate from any other, and Commons — the only approved provider — is also
// where every rejected candidate in this project has come from.
//
// A provider is listed here whether or not it is enabled, with the reason. A
// registry that only names what is switched on cannot tell you what was
// considered and declined, and "we looked at Unsplash and here is the clause
// that stopped us" is a more useful record than silence.
//
// The engine is NOT built around Wikimedia Commons. pipeline.ts imports no
// provider at all and takes the list as a parameter; this file is the only
// place any specific source is named, and adding a second one is a matter of
// implementing `MediaProvider` and adding an entry.

import { createCommonsProvider, COMMONS_APPROVAL } from "./wikimedia-commons.ts";
import type { SubjectIdentity } from "./query-expansion.ts";
import type { MediaProvider, ProviderApproval, ProviderId } from "./types.ts";

/**
 * Providers considered but NOT enabled, with the reason each is off.
 *
 * These are data, not commentary: the pipeline reads `approvedForSearch` and
 * refuses to call anything false, and it records the rationale in the query
 * log so a report says why a source was not searched rather than omitting it.
 */
export const DISABLED_PROVIDERS: ProviderApproval[] = [
  {
    id: "openverse",
    label: "Openverse",
    approvedForSearch: false,
    exposesPrimaryEvidence: false,
    requestSpacingMs: 1000,
    termsUrl: "https://openverse.org/",
    rationale:
      "DISCOVERY-CAPABLE, RIGHTS-INCAPABLE. Tested 2026-08-22 (docs/product-media-strategy.md §6): it found nothing " +
      "new for any blocked product, and it presented every result with a clean licence badge and NO ROUTE TO THE " +
      "EVIDENCE UNDERNEATH — no wikitext, no EXIF, no uploader chain. Every asset it surfaced had already been " +
      "examined at source and rejected for a reason invisible in its API response. It also matched 159 NASA " +
      "photographs of light ECHOES to 'Echo Show 8'. Could be re-enabled as a pure discovery aid IF every hit were " +
      "re-resolved at its origin provider; it must never be a rights source.",
  },
  {
    id: "flickr",
    label: "Flickr",
    approvedForSearch: false,
    exposesPrimaryEvidence: true,
    requestSpacingMs: 1000,
    termsUrl: "https://www.flickr.com/creativecommons/",
    rationale:
      "NOT YET ASSESSED. Flickr does expose a per-photo licence page showing the photographer's own selection, which " +
      "is genuine primary evidence, and it is where much of Openverse's non-Commons inventory originates. Enabling it " +
      "needs its API terms read and quoted first, and an API key. Listed so the gap is visible rather than forgotten.",
  },
  {
    id: "pexels",
    label: "Pexels",
    approvedForSearch: false,
    exposesPrimaryEvidence: false,
    requestSpacingMs: 1000,
    termsUrl: "https://www.pexels.com/license/",
    rationale:
      "INVESTIGATED, NOT ENABLED — see docs/stock-provider-assessment.md for the quoted clauses. Requires an API key " +
      "(a signup), and its licence is a platform grant rather than a per-photo licence with a per-photo evidence " +
      "trail, so it cannot support the verification this pipeline performs.",
  },
  {
    id: "unsplash",
    label: "Unsplash",
    approvedForSearch: false,
    exposesPrimaryEvidence: false,
    requestSpacingMs: 1000,
    termsUrl: "https://unsplash.com/license",
    rationale:
      "INVESTIGATED, NOT ENABLED — see docs/stock-provider-assessment.md for the quoted clauses. Same structural " +
      "objection as Pexels plus API-specific obligations (download tracking, hotlinking) that change how the media " +
      "pipeline would have to work.",
  },
];

export const ALL_PROVIDER_APPROVALS: ProviderApproval[] = [COMMONS_APPROVAL, ...DISABLED_PROVIDERS];

export function approvalFor(id: ProviderId): ProviderApproval | null {
  return ALL_PROVIDER_APPROVALS.find((a) => a.id === id) ?? null;
}

/**
 * Build the provider instances the engine may search for one subject.
 *
 * Returns only enabled providers. A disabled one is not instantiated at all,
 * so there is no object sitting around that a future caller could invoke by
 * mistake — the approval flag is not a runtime check that could be forgotten.
 */
export function buildEnabledProviders(identity: SubjectIdentity): MediaProvider[] {
  const providers: MediaProvider[] = [];
  if (COMMONS_APPROVAL.approvedForSearch) providers.push(createCommonsProvider({ identity }));
  return providers;
}
