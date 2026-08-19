// Placement abstraction only — no ad network is integrated. Renders nothing
// unless a slot id is explicitly enabled via NEXT_PUBLIC_ADS_ENABLED, so the
// public site never shows placeholder ad boxes. Swap the body of this
// component for a real ad network's tag once one is selected.
const ADS_ENABLED = process.env.NEXT_PUBLIC_ADS_ENABLED === "true";

export function AdSlot({ id, className }: { id: string; className?: string }) {
  if (!ADS_ENABLED) return null;

  return (
    <div id={`ad-slot-${id}`} data-ad-slot={id} className={className} aria-hidden="true">
      {/* Ad network markup goes here once one is configured. */}
    </div>
  );
}
