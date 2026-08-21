import Link from "next/link";
import type { ClaimStatus, JobStatus, MediaRightsStatus, TrustLevel } from "@/lib/engine/types";
import { Badge } from "@/components/admin/ui";

// Shared presentation helpers for the Growth Engine admin pages. Kept in one
// place so a claim status or rights status always renders the same way
// wherever it appears — an admin shouldn't have to relearn the colour coding
// per page.

const ENGINE_TABS: { href: string; label: string }[] = [
  { href: "/admin/engine", label: "Health" },
  { href: "/admin/engine/sources", label: "Sources" },
  { href: "/admin/engine/discoveries", label: "Discoveries" },
  { href: "/admin/engine/opportunities", label: "Opportunities" },
  { href: "/admin/engine/briefs", label: "Review queue" },
  { href: "/admin/engine/searches", label: "Searches" },
  { href: "/admin/engine/freshness", label: "Freshness" },
  { href: "/admin/engine/media-blockers", label: "Media blockers" },
];

export function EngineTabs({ current }: { current: string }) {
  return (
    <div className="flex flex-wrap gap-2 mb-6 border-b border-neutral-200 pb-3">
      {ENGINE_TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === current ? "page" : undefined}
          className={`rounded-full px-3 py-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 ${
            tab.href === current ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function humanise(value: string): string {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

type Tone = "neutral" | "green" | "amber" | "red" | "blue";

// A rumour and a confirmed primary source must never look alike at a glance —
// this mapping is the visual half of the "don't treat repetition as truth"
// rule enforced in confidence.ts.
const CLAIM_TONE: Record<ClaimStatus, Tone> = {
  confirmed_primary: "green",
  reported_secondary: "blue",
  estimate: "amber",
  leak: "amber",
  rumour: "red",
  unverified: "neutral",
};

export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  return <Badge tone={CLAIM_TONE[status] ?? "neutral"}>{humanise(status)}</Badge>;
}

const TRUST_TONE: Record<TrustLevel, Tone> = {
  primary: "green",
  secondary: "blue",
  community: "neutral",
};

export function TrustBadge({ level }: { level: TrustLevel }) {
  return <Badge tone={TRUST_TONE[level] ?? "neutral"}>{humanise(level)}</Badge>;
}

// "unverified" is amber rather than neutral on purpose: an unassessed source
// is an open question, not a benign default.
const MEDIA_RIGHTS_TONE: Record<MediaRightsStatus, Tone> = {
  confirmed_usable: "green",
  requires_registration: "blue",
  unclear_manual_review: "amber",
  unverified: "amber",
  no_source_found: "neutral",
  prohibited: "red",
};

export function MediaRightsBadge({ status }: { status: MediaRightsStatus }) {
  return <Badge tone={MEDIA_RIGHTS_TONE[status] ?? "neutral"}>{humanise(status)}</Badge>;
}

const JOB_TONE: Record<JobStatus, Tone> = {
  success: "green",
  running: "blue",
  partial: "amber",
  skipped: "neutral",
  failed: "red",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <Badge tone={JOB_TONE[status] ?? "neutral"}>{humanise(status)}</Badge>;
}

const STATE_TONE: Record<string, Tone> = {
  discovered: "neutral",
  researched: "blue",
  evidence_checked: "blue",
  planned: "blue",
  drafting: "amber",
  media_check: "amber",
  review_eligible: "green",
  published: "green",
  blocked: "red",
  rejected: "neutral",
  error: "red",
};

export function StateBadge({ state }: { state: string }) {
  return <Badge tone={STATE_TONE[state] ?? "neutral"}>{humanise(state)}</Badge>;
}

// Relevance verdicts. "uncertain" is amber rather than neutral for the same
// reason unverified media rights are: an undecided item is an open question
// needing a human, not a settled default.
const RELEVANCE_TONE: Record<string, Tone> = {
  relevant: "green",
  uncertain: "amber",
  rejected: "neutral",
};

export function RelevanceBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return <Badge tone="neutral">Not yet classified</Badge>;
  return <Badge tone={RELEVANCE_TONE[verdict] ?? "neutral"}>{humanise(verdict)}</Badge>;
}

// Review states. Rejected is red here (unlike a rejected *discovery*, which is
// merely parked) because rejecting a brief is an explicit human decision to
// not cover something.
const REVIEW_TONE: Record<string, Tone> = {
  pending: "amber",
  approved: "green",
  rejected: "red",
  snoozed: "blue",
  research_requested: "blue",
};

export function ReviewStateBadge({ state }: { state: string }) {
  return <Badge tone={REVIEW_TONE[state] ?? "neutral"}>{humanise(state)}</Badge>;
}

// Freshness sensitivity drives how quickly a brief loses value, so it reads as
// urgency: breaking is red, evergreen is calm.
const FRESHNESS_TONE: Record<string, Tone> = {
  breaking: "red",
  time_sensitive: "amber",
  evergreen: "green",
};

export function FreshnessSensitivityBadge({ value }: { value: string | null }) {
  if (!value) return null;
  return <Badge tone={FRESHNESS_TONE[value] ?? "neutral"}>{humanise(value)}</Badge>;
}

export function BriefKindBadge({ kind }: { kind: string | null }) {
  if (!kind) return <Badge tone="neutral">Kind not set</Badge>;
  return <Badge tone="blue">{humanise(kind)}</Badge>;
}

/** Milliseconds -> short human duration, for job-run timings. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
