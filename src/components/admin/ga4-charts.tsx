// Real chart/graph components for the GA4 section of /admin/analytics —
// plain inline SVG/CSS, same "no charting library" convention as the
// first-party TrafficChart/Sparkline in analytics-tables.tsx. These assume
// they're only rendered once GA4 is connected AND the section actually has
// rows (the page's SectionCard wrapper already gates on connected/hasRows —
// see analytics/page.tsx) — the "no data" paragraphs below are a defensive
// fallback, not the primary empty-state path.

const RANK_COLOR = "#2563eb";
const DONUT_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#7c3aed", "#0891b2"];

export type RankedRow = { key: string; label: string; sublabel?: string | null; value: number | null };

// Horizontal ranked bar chart — used for Geography, Acquisition, Content
// performance, Browser, OS. The numeric value is always rendered as visible
// text next to the bar, not conveyed by bar length alone (accessibility —
// screen readers and colour-blind users must not depend on length/hue).
export function RankedBarChart({ rows, color = RANK_COLOR, valueSuffix = "" }: { rows: RankedRow[]; color?: string; valueSuffix?: string }) {
  const clean = rows.filter((r): r is RankedRow & { value: number } => r.value !== null);
  if (clean.length === 0) return <p className="text-sm text-neutral-500">No data returned for this range yet.</p>;
  const sorted = [...clean].sort((a, b) => b.value - a.value);
  const max = Math.max(...sorted.map((r) => r.value), 1);
  return (
    <div className="overflow-x-auto">
      <div className="flex flex-col gap-2 min-w-[260px]">
        {sorted.map((r) => (
          <div key={r.key} className="flex items-center gap-2">
            <div className="w-32 shrink-0 truncate text-xs text-neutral-600" title={r.sublabel ? `${r.label} (${r.sublabel})` : r.label}>
              {r.label}
              {r.sublabel ? <span className="text-neutral-400"> ({r.sublabel})</span> : null}
            </div>
            <div className="flex-1 h-3 rounded bg-neutral-100 overflow-hidden">
              <div className="h-full rounded" style={{ width: `${Math.max((r.value / max) * 100, 2)}%`, backgroundColor: color }} />
            </div>
            <div className="w-14 shrink-0 text-right text-xs font-medium text-neutral-900">
              {r.value}
              {valueSuffix}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Donut — deliberately reserved for Device (desktop/mobile/tablet), which
// genuinely has few categories. Browser/OS use RankedBarChart instead since
// they can have many categories, where a donut becomes unreadable.
export function DeviceDonut({ rows }: { rows: { label: string; value: number | null }[] }) {
  const clean = rows.filter((r): r is { label: string; value: number } => r.value !== null && r.value > 0);
  const total = clean.reduce((s, r) => s + r.value, 0);
  if (clean.length === 0 || total === 0) return <p className="text-sm text-neutral-500">No data returned for this range yet.</p>;

  const size = 120;
  const radius = 45;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  const segments = clean.reduce<Array<{ label: string; value: number; color: string; dash: number; offset: number }>>(
    (acc, r, i) => {
      const previousEnd = acc.length > 0 ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
      const dash = (r.value / total) * circumference;
      acc.push({ ...r, color: DONUT_COLORS[i % DONUT_COLORS.length], dash, offset: previousEnd });
      return acc;
    },
    []
  );

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Sessions by device type">
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          {segments.map((s) => (
            <circle
              key={s.label}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={20}
              strokeDasharray={`${s.dash} ${circumference - s.dash}`}
              strokeDashoffset={-s.offset}
            />
          ))}
        </g>
      </svg>
      <ul className="flex flex-col gap-1.5 text-xs">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} aria-hidden="true" />
            <span className="text-neutral-700">{s.label}</span>
            <span className="font-medium text-neutral-900">{Math.round((s.value / total) * 100)}%</span>
            <span className="text-neutral-400">({s.value})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Entrances vs exits per page — a paired horizontal comparison bar, more
// informative than a bare two-column table for spotting pages that are
// mostly entries (landing pages) vs mostly exits (drop-off points).
export function JourneyBars({ rows }: { rows: { path: string; entrances: number | null; exits: number | null }[] }) {
  const clean = rows.filter((r) => r.entrances !== null || r.exits !== null);
  if (clean.length === 0) return <p className="text-sm text-neutral-500">No data returned for this range yet.</p>;
  const max = Math.max(...clean.map((r) => Math.max(r.entrances ?? 0, r.exits ?? 0)), 1);
  return (
    <div className="overflow-x-auto">
      <div className="flex flex-col gap-3 min-w-[280px]">
        {clean.map((r) => (
          <div key={r.path}>
            <p className="text-xs text-neutral-600 truncate mb-1" title={r.path}>
              {r.path}
            </p>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-neutral-400">Entries</span>
              <div className="flex-1 h-2.5 rounded bg-neutral-100 overflow-hidden">
                <div
                  className="h-full rounded bg-blue-600"
                  style={{ width: `${(r.entrances ?? 0) > 0 ? Math.max(((r.entrances ?? 0) / max) * 100, 2) : 0}%` }}
                />
              </div>
              <span className="w-10 shrink-0 text-right text-xs font-medium text-neutral-900">{r.entrances ?? "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-neutral-400">Exits</span>
              <div className="flex-1 h-2.5 rounded bg-neutral-100 overflow-hidden">
                <div
                  className="h-full rounded bg-orange-500"
                  style={{ width: `${(r.exits ?? 0) > 0 ? Math.max(((r.exits ?? 0) / max) * 100, 2) : 0}%` }}
                />
              </div>
              <span className="w-10 shrink-0 text-right text-xs font-medium text-neutral-900">{r.exits ?? "—"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
