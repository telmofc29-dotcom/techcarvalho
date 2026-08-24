import "server-only";

// Resolves the context `assessCorroboration` needs, from recorded data only.
//
// THE ONE RULE THAT MATTERS: SUBJECT DOMAINS ARE NEVER GUESSED.
//
// First-party authority is the single place in the evidence model where one
// source is enough, so "is this publisher the subject?" decides whether a claim
// needs one source or three. Inferring `apple.com` from the string "Apple"
// would hand that authority to any domain nobody verified, silently, on a
// substring match.
//
// WHERE THE ANSWER COMES FROM
// ---------------------------
// `engine_sources.trust_level`, which already encodes exactly this and was
// simply never consulted for it. The registry records 29 sources: 28 at
// `primary` and one (DPReview) at `secondary`. That is not an accident of data
// entry — "primary source" means the body with direct authority over the facts,
// which for a vendor newsroom or a standards body is its own announcements.
// DPReview is `secondary` because it reports on other people's products.
//
// So a domain is treated as its own subject when a registered source at
// `primary` trust publishes on it. Nothing is inferred from names, and a domain
// nobody registered gets no authority at all.
//
// WHY NOT manufacturer_id
// -----------------------
// The obvious route — discovery -> manufacturer -> website — is dead in
// production: `manufacturer_id` is NULL on every discovery, because nothing in
// the pipeline ever links one. It is also the wrong shape even when populated,
// since Mozilla, NASA, VESA, IETF, Arduino and the Bluetooth SIG all publish
// first-party announcements and none of them is a manufacturer.
//
// FAIL-CLOSED IN EVERY DIRECTION
// ------------------------------
// A failed read, an unregistered domain, or a `secondary`/`community` source
// all produce an empty subject-domain set, and brief-quality.ts treats an empty
// set as "use the strict two-independent-publishers rule". Nothing here can
// grant authority it did not verify.

import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import { hostOf, registrableDomain } from "./independence.ts";
import type { ClaimStatus } from "./types.ts";

export type BriefCorroborationContext = {
  claimStatus: ClaimStatus;
  subjectDomains: string[];
  aboutUnreleasedProduct: boolean;
};

/**
 * Domains on which a registered `primary`-trust source publishes.
 *
 * These are the bodies that speak for themselves. `secondary` and `community`
 * sources are deliberately excluded: an independent publication reporting about
 * a third party is the exact case that still needs corroboration.
 */
export async function loadFirstPartyDomains(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Set<string>> {
  const out = new Set<string>();
  const { data, error } = await supabase
    .from("engine_sources")
    .select("url, trust_level, is_active")
    .eq("trust_level", "primary");
  if (error) {
    logQueryError("loadFirstPartyDomains", error);
    // Empty set == strict path everywhere. Correct direction to fail.
    return out;
  }
  for (const s of (data ?? []) as { url: string }[]) {
    const d = registrableDomain(hostOf(s.url));
    if (d) out.add(d.toLowerCase());
  }
  return out;
}

/**
 * Load corroboration context for a set of briefs, keyed by brief id.
 *
 * Batched: three reads regardless of how many briefs are passed.
 */
export async function loadCorroborationContext(
  briefs: readonly { id: string; discoveryId: string | null; sourceUrls: readonly string[] }[]
): Promise<Map<string, BriefCorroborationContext>> {
  const out = new Map<string, BriefCorroborationContext>();
  if (briefs.length === 0) return out;

  const supabase = await createClient();
  const firstParty = await loadFirstPartyDomains(supabase);

  const discoveryIds = [...new Set(briefs.map((b) => b.discoveryId).filter((v): v is string => !!v))];
  const claimByDiscovery = new Map<string, ClaimStatus>();
  if (discoveryIds.length > 0) {
    const { data, error } = await supabase
      .from("engine_discoveries")
      .select("id, claim_status")
      .in("id", discoveryIds);
    if (error) logQueryError("loadCorroborationContext discoveries", error);
    for (const d of (data ?? []) as { id: string; claim_status: ClaimStatus }[]) {
      claimByDiscovery.set(d.id, d.claim_status);
    }
  }

  for (const brief of briefs) {
    // The subject domains for THIS brief are the ones among its own sources
    // that a primary-trust source publishes on. A brief citing mozilla.org and
    // theverge.com yields ["mozilla.org"], so mozilla.org is the subject and
    // theverge.com counts as the independent pickup — which is exactly right.
    const subjectDomains: string[] = [];
    for (const url of brief.sourceUrls) {
      const d = registrableDomain(hostOf(url));
      if (d && firstParty.has(d.toLowerCase())) subjectDomains.push(d.toLowerCase());
    }
    if (subjectDomains.length === 0) continue;

    out.set(brief.id, {
      claimStatus: brief.discoveryId
        ? (claimByDiscovery.get(brief.discoveryId) ?? "unverified")
        : "unverified",
      subjectDomains: [...new Set(subjectDomains)],
      // Not derivable without a linked product row, and `manufacturer_id` /
      // `product_id` are unpopulated in production. Left false rather than
      // guessed — guessing TRUE would raise the bar on things that do not need
      // it, and guessing FALSE on a real unreleased product is the dangerous
      // direction, so this is stated as a known limitation rather than hidden.
      aboutUnreleasedProduct: false,
    });
  }

  return out;
}
