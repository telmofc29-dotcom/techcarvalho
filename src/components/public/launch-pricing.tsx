import type { LaunchPricing } from "@/lib/public/product-detail";

const CURRENCY_ORDER: LaunchPricing["currency"][] = ["USD", "GBP", "EUR"];
const LOCALE_BY_CURRENCY: Record<LaunchPricing["currency"], string> = {
  USD: "en-US",
  GBP: "en-GB",
  EUR: "de-DE",
};

function formatAmount(currency: LaunchPricing["currency"], amount: number): string {
  return new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency], {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

// Shows only currencies genuinely present in product_launch_pricing (see
// supabase/migrations_pending/20260821_product_launch_pricing.sql — not yet
// applied to production, so this renders nothing for every product today).
// Never fabricates a missing currency by converting from one that IS
// present — if only USD was ever sourced, only USD shows. An is_estimated
// row is always visibly labelled, never presented as an equally reliable
// sourced figure.
export function LaunchPricingDisplay({ pricing }: { pricing: LaunchPricing[] }) {
  if (pricing.length === 0) return null;

  const byCurrency = new Map(pricing.map((p) => [p.currency, p]));
  const ordered = CURRENCY_ORDER.map((c) => byCurrency.get(c)).filter((p): p is LaunchPricing => p !== undefined);

  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
      <span className="text-xs uppercase tracking-wide text-zinc-500">Launch price</span>
      {ordered.map((p) => (
        <span key={p.currency} className="font-medium text-zinc-900">
          {formatAmount(p.currency, p.amount)}
          {p.is_estimated && <span className="ml-1 text-xs font-normal text-zinc-400">(approximate)</span>}
        </span>
      ))}
    </div>
  );
}
