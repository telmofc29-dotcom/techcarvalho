import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { PageHeader, Card, QueryErrorBanner } from "@/components/admin/ui";
import { Badge } from "@/components/shared/ui";
import { SubmitButton } from "@/components/admin/submit-button";
import { loadOwnerQueue, loadEngineHealth } from "@/lib/engine/queue-service";
import {
  QUEUE_KIND_LABELS,
  waitingDays,
  type OwnerQueueItem,
  type SignalTone,
} from "@/lib/engine/owner-queue";
import { BRIEF_QUALITY_LABELS, BRIEF_QUALITY_STATES } from "@/lib/engine/brief-quality";
import { setBriefReviewState } from "./actions";
import { EngineTabs, formatDateTime } from "./shared";
import { RotationPanel } from "./rotation-panel";

// TODAY — the engine's front door.
//
// Everything an owner needs in order to act is on this page, and everything
// else is one click away under "Engine details". The previous front door was
// the health dashboard: kill switch, settings form, and 200 job runs. That is
// the right page for debugging a stage and the wrong one for deciding what to
// publish, and it is why 130 pending records accumulated behind fourteen tabs
// with nobody acting on any of them.
//
// The page answers three questions, in this order:
//   1. Is the engine running?          (one line, not a job table)
//   2. What did it find, and what did it filter out?  (the funnel)
//   3. What needs ME?                  (the queue)
//
// Question 2 exists because of question 3's most likely answer. When the
// quality gate is doing its job the queue is often EMPTY, and an empty page
// with no explanation looks broken — or worse, looks like the engine stopped.
// The funnel is the evidence that it did not.

export const dynamic = "force-dynamic";

export default async function EngineTodayPage() {
  await requireAdmin();
  const [queue, health] = await Promise.all([loadOwnerQueue(), loadEngineHealth()]);

  return (
    <div>
      <PageHeader
        title="Today"
        description="Everything the engine needs a decision on, in one place."
      />
      <EngineTabs current="/admin/engine" />

      {queue.failures.length > 0 && (
        <QueryErrorBanner
          message={
            `This list is INCOMPLETE — ${queue.failures.length} source(s) could not be read: ` +
            queue.failures.map((f) => `${f.source} (${f.message})`).join("; ") +
            ". Treat the queue below as partial, not as empty."
          }
        />
      )}

      <EngineStatusLine health={health} />
      <Funnel queue={queue} />
      <RotationPanel />
      <AttentionList queue={queue} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Is it running?
// ---------------------------------------------------------------------------

function EngineStatusLine({ health }: { health: Awaited<ReturnType<typeof loadEngineHealth>> }) {
  // "Unknown" is rendered distinctly from "stopped" on purpose: a failed
  // settings read and a disabled engine imply completely different next
  // actions, and collapsing them into one boolean would send the owner to
  // debug the wrong thing.
  const state = health.unknown
    ? { tone: "amber" as const, text: "Status unknown" }
    : !health.masterEnabled
      ? { tone: "red" as const, text: "Engine stopped" }
      : health.healthy
        ? { tone: "green" as const, text: "Engine running" }
        : { tone: "amber" as const, text: "Running with failures" };

  return (
    <Card className="p-5 mb-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <Badge tone={state.tone}>{state.text}</Badge>
        </div>
        <p className="text-sm text-neutral-500">
          Last run <span className="text-neutral-900">{formatDateTime(health.lastRunAt)}</span>
        </p>
        <p className="text-sm text-neutral-500">
          Next run <span className="text-neutral-900">{nextRunLabel()}</span>
        </p>
        <Link
          href="/admin/engine/health"
          className="text-sm font-medium text-neutral-900 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        >
          Engine details
        </Link>
      </div>

      {health.unknown && (
        <p className="mt-3 text-sm text-amber-700">
          Engine settings could not be read. This is not the same as the engine being off — check
          server logs before changing anything.
        </p>
      )}
      {health.failingStages.length > 0 && (
        <p className="mt-3 text-sm text-amber-700">
          Last run failed or was partial for: {health.failingStages.join(", ")}.{" "}
          <Link href="/admin/engine/health" className="underline underline-offset-4">
            See the run log
          </Link>
          .
        </p>
      )}
    </Card>
  );
}

/**
 * The next scheduled tick, from the single cron entry in vercel.json
 * (`30 4 * * *`, UTC).
 *
 * Derived rather than stored. If that schedule changes this label goes stale,
 * which is why it names the schedule it assumes rather than presenting a bare
 * timestamp as fact.
 */
function nextRunLabel(): string {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4, 30, 0)
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// ---------------------------------------------------------------------------
// 2. What did it find, and what did it filter?
// ---------------------------------------------------------------------------

function Funnel({ queue }: { queue: Awaited<ReturnType<typeof loadOwnerQueue>> }) {
  const q = queue.briefQuality;
  const filtered = q.total - q.ownerQueueCount;

  return (
    <Card className="p-5 mb-6">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
        Content opportunities
      </h2>
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        <Stat value={q.total} label="found" />
        <Stat value={q.ownerQueueCount} label="worth your review" emphasis />
        <Stat value={filtered} label="filtered out" />
        <Stat value={q.researchBacklogCount} label="engine still researching" />
      </div>

      {q.total > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-neutral-600 hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900">
            Why {filtered} were filtered
          </summary>
          <ul className="mt-3 space-y-1">
            {BRIEF_QUALITY_STATES.filter((s) => s !== "ready_for_review").map((s) => (
              <li key={s} className="flex justify-between gap-4 text-sm max-w-md">
                <span className="text-neutral-600">{BRIEF_QUALITY_LABELS[s]}</span>
                <span className="tabular-nums text-neutral-900">{q.counts[s]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-neutral-500 max-w-prose">
            Nothing here is deleted. Weak briefs stay in the backlog and the engine keeps
            researching the ones that can improve —{" "}
            <Link href="/admin/engine/briefs" className="underline underline-offset-4">
              see all briefs
            </Link>
            .
          </p>
        </details>
      )}
    </Card>
  );
}

function Stat({ value, label, emphasis = false }: { value: number; label: string; emphasis?: boolean }) {
  return (
    <div>
      <p
        className={`text-2xl font-semibold tabular-nums ${
          emphasis && value > 0 ? "text-neutral-900" : "text-neutral-900"
        }`}
      >
        {value}
      </p>
      <p className="text-sm text-neutral-500 mt-0.5">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. What needs me?
// ---------------------------------------------------------------------------

function AttentionList({ queue }: { queue: Awaited<ReturnType<typeof loadOwnerQueue>> }) {
  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Needs your attention
        </h2>
        {queue.summary.total > 0 && (
          <span className="text-xs text-neutral-500 tabular-nums">{queue.summary.total} item(s)</span>
        )}
      </div>

      {queue.summary.total === 0 ? (
        <NothingToDo queue={queue} />
      ) : (
        <div className="space-y-4">
          {queue.items.map((item) => (
            <QueueRow key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The empty state, which is the state this page is in most of the time.
 *
 * It must never look like a failure or like the engine stopped. So it states
 * what WAS examined, and it distinguishes the two genuinely different reasons
 * the queue can be empty: nothing cleared the bar (normal, engine working), or
 * a source could not be read (not normal, and already bannered above).
 */
function NothingToDo({ queue }: { queue: Awaited<ReturnType<typeof loadOwnerQueue>> }) {
  const q = queue.briefQuality;
  return (
    <Card className="p-6">
      <p className="text-base font-medium text-neutral-900">Nothing needs a decision right now.</p>
      {queue.failures.length > 0 ? (
        <p className="mt-2 text-sm text-amber-700 max-w-prose">
          Note that {queue.failures.length} source(s) failed to load, so this is not a complete
          answer — see the banner above.
        </p>
      ) : (
        <p className="mt-2 text-sm text-neutral-500 max-w-prose">
          The engine examined {q.total} brief{q.total === 1 ? "" : "s"} and none currently clears the
          evidence bar. {q.researchBacklogCount} {q.researchBacklogCount === 1 ? "is" : "are"} still
          being researched and will appear here if they improve. This is the engine working, not
          waiting.
        </p>
      )}
    </Card>
  );
}

const TONE_MAP: Record<SignalTone, "neutral" | "green" | "amber" | "red" | "blue"> = {
  good: "green",
  warn: "amber",
  bad: "red",
  neutral: "neutral",
};

function QueueRow({ item }: { item: OwnerQueueItem }) {
  const days = waitingDays(item);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Badge tone="blue">{QUEUE_KIND_LABELS[item.kind]}</Badge>
            <span className="text-sm text-neutral-500">{item.headline}</span>
            {days >= 7 && (
              <span className="text-xs text-amber-700 tabular-nums">waiting {days} days</span>
            )}
          </div>
          <h3 className="text-base font-semibold text-neutral-900">{item.title}</h3>
          <p className="mt-1 text-sm text-neutral-600 max-w-prose">{item.why}</p>
        </div>
      </div>

      {item.signals.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {item.signals.map((s, i) => (
            <li key={i}>
              <Badge tone={TONE_MAP[s.tone]}>{s.label}</Badge>
            </li>
          ))}
        </ul>
      )}

      {item.gaps.length > 0 && (
        <ul className="mt-3 space-y-1">
          {item.gaps.map((g, i) => (
            <li key={i} className="text-sm text-amber-700">
              {g}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <QueueActions item={item} />
        <Link
          href={item.kind === "brief" ? "/admin/engine/briefs" : item.href}
          className="text-sm font-medium text-neutral-600 underline underline-offset-4 hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        >
          View details
        </Link>
      </div>
    </Card>
  );
}

/**
 * Actions are rendered per kind rather than generically.
 *
 * A generic Approve/Reject pair would have to map onto four different tables
 * with four different meanings, and "approve" a rights blocker is not a
 * coherent instruction — the rights decision needs the asset in front of you.
 * So kinds that cannot be safely decided from a summary row link out instead of
 * offering a button that pretends they can.
 */
function QueueActions({ item }: { item: OwnerQueueItem }) {
  if (item.kind !== "brief") {
    return (
      <Link
        href={item.href}
        className="inline-flex items-center rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
      >
        Review
      </Link>
    );
  }

  // "Review package" is the primary path: it shows every consequence before
  // asking. Bare "Approve" stays alongside it for an owner who already knows
  // this one and does not want the round trip — but it is the secondary
  // control, because approving without seeing the consequences is exactly the
  // habit this phase is trying to end.
  return (
    <>
      <Link
        href={item.href}
        className="inline-flex items-center rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
      >
        Review package
      </Link>
      <form action={setBriefReviewState}>
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="review_state" value="approved" />
        <SubmitButton variant="secondary">Approve</SubmitButton>
      </form>
      <form action={setBriefReviewState}>
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="review_state" value="rejected" />
        <SubmitButton variant="secondary">Reject</SubmitButton>
      </form>
      <form action={setBriefReviewState}>
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="review_state" value="snoozed" />
        <input type="hidden" name="snooze_days" value="14" />
        <SubmitButton variant="secondary">Ignore for now</SubmitButton>
      </form>
    </>
  );
}
