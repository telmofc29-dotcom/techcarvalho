import type { ReactNode } from "react";

// --- Touch target sizing -------------------------------------------------
//
// The project standard is a 44px minimum tap target (Apple HIG / comfortable
// thumb), deliberately stricter than WCAG 2.2 SC 2.5.8's 24px floor. Two
// techniques, and which one to use is decided by whether growing the visible
// box would disturb the surrounding text:
//
// TOUCH_TARGET grows the BOX. `min-h-11` plus flex centring, for controls
// that own their line: pills, pager buttons, breadcrumb links, filter
// controls. The label keeps its type size — only the hit rectangle grows,
// so nothing is visually bloated.
//
// TOUCH_INLINE grows the HIT RECTANGLE ONLY, via a transparent ::before
// overlay centred on the link. A pseudo-element does not participate in
// layout, so an inline link sitting in a running sentence becomes 44px tall
// to a thumb while the line box, the leading and the paragraph's wrapping
// are all completely unchanged. Vertical padding cannot do this job reliably
// because the height it yields depends on the inherited line-height; the
// overlay is a fixed 44px regardless of type size. Requires `relative` on
// the link, which TOUCH_INLINE includes.
//
// NOTE for anyone re-measuring this: getBoundingClientRect() reports the
// element's own border box and therefore does NOT see the ::before overlay.
// A script that reads rects alone will report these links as ~16-20px tall
// and "unfixed". Probe document.elementFromPoint instead — that is what a
// real tap resolves against.
//
// NOT applied to inline links inside body prose (article body, legal-page
// copy). WCAG 2.5.8 explicitly exempts links in a block of text, and giving
// every prose link a 44px overlay would make adjacent links on consecutive
// lines overlap each other.
// min-W-11 as well as min-h-11: a short label ("Home", "Canon", a page
// number) clears 44px vertically but can still be under 44px WIDE, which is
// just as much of a miss for a thumb. justify-center keeps the label centred
// in the widened box, so a short crumb shifts by at most ~3px.
export const TOUCH_TARGET = "inline-flex min-h-11 min-w-11 items-center justify-center";
export const TOUCH_INLINE =
  "relative before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "blue";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-neutral-100 text-neutral-700",
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-blue-100 text-blue-800",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 py-16 text-center">
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      {description && <p className="text-sm text-neutral-500 max-w-sm">{description}</p>}
      {action}
    </div>
  );
}
