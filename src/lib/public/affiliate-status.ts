import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";

/**
 * What the site's own database says about outbound retailer links, right now.
 *
 * WHY THE DISCLOSURE PAGE READS THE DATABASE INSTEAD OF STATING A FACT
 * --------------------------------------------------------------------
 * "Tech Carvalho does not currently participate in any affiliate programs" is
 * true today and is the single most perishable sentence on the site: the day
 * somebody adds an affiliate offer in the admin UI, the affiliate disclosure
 * page becomes a false statement and nothing anywhere would notice. A
 * disclosure that can silently go stale is worse than no disclosure, because
 * readers rely on it precisely when it is wrong.
 *
 * So the page asserts only what the catalogue can back at render time.
 *
 * `null` means THE CHECK FAILED and is never rendered as zero — the
 * empty-vs-failed rule this project wrote down after every public page spent
 * weeks showing an honest-looking empty state over a broken query.
 */
export type AffiliateStatusSnapshot = {
  /** Active retailer/"where to buy" links of any kind. null = check failed. */
  activeOffers: number | null;
  /** Of those, how many are affiliate links. null = check failed. */
  affiliateOffers: number | null;
  /** Distinct retailers behind the affiliate links, for naming them. */
  affiliateRetailers: string[];
};

export const getAffiliateStatus = cache(async (): Promise<AffiliateStatusSnapshot> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("product_offers").select("retailer, affiliate_status, is_active");
  logQueryError("getAffiliateStatus", error);

  if (error || !data) {
    return { activeOffers: null, affiliateOffers: null, affiliateRetailers: [] };
  }

  const active = data.filter((offer) => offer.is_active);
  // 'pending' is an affiliate relationship being set up and NOT yet live —
  // outboundLinkKindFor() in src/lib/monetisation/affiliate.ts refuses to
  // render it as an affiliate link, so counting it as one here would disclose
  // a commission that is not being earned. Same rule, one source.
  const affiliate = active.filter((offer) => offer.affiliate_status === "affiliate");

  return {
    activeOffers: active.length,
    affiliateOffers: affiliate.length,
    affiliateRetailers: [...new Set(affiliate.map((offer) => offer.retailer))].sort(),
  };
});
