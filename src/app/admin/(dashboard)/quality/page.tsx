import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { getQualityOverview } from "@/lib/admin/quality-service";
import { INTENT_FLOOR, DEFAULT_FLOOR, type ContentVerdict } from "@/lib/content/quality-inventory";
import { PageHeader, Card, Badge, EmptyState, TextLink } from "@/components/admin/ui";

// The editorial backlog.
//
// Recomputed on every load from the current database rather than quoted from a
// script run weeks ago — see the header of lib/admin/quality-service.ts.
//
// WHAT THIS PAGE DELIBERATELY DOES NOT DO
// ---------------------------------------
// It does not merge anything, and it does not offer a button that would. The
// MERGE column is a list of CANDIDATES for a person to look at, because the
// overlap detector has a demonstrated history of dangerous false positives on
// this exact corpus: an earlier version proposed folding a Canon 6D comparison
// into a PlayStation 5 article, on the strength of both titles containing
// "actually", "worth" and "upgrade". The current detector requires a shared
// linked PRODUCT before it will suggest anything, which is what makes the
// suggestions worth reading at all — but product and subject identity is a
// judgement, and the judgement stays with the editor.

export const metadata = { title: "Content quality" };

const VERDICT_ORDER: ContentVerdict[] = ["IMPROVE", "MERGE", "REVIEW", "KEEP"];

const VERDICT_TONE: Record<ContentVerdict, "red" | "amber" | "neutral" | "green"> = {
  IMPROVE: "amber",
  MERGE: "red",
  REVIEW: "neutral",
  KEEP: "green",
};

const VERDICT_NOTE: Record<ContentVerdict, string> = {
  IMPROVE:
    "Real potential, materially under-served. These are worth research time — not filler. " +
    "Padding a thin page to clear a word count makes it worse, and would be visible to a reviewer.",
  MERGE:
    "Candidates only. Nothing is merged automatically. Two pieces must cover the same PRODUCT " +
    "and the same question before folding one in — shared editorial words are not evidence.",
  REVIEW: "Ambiguous on the signals available. A person decides.",
  KEEP: "Good as it stands. Listed so the backlog is the whole corpus, not just its problems.",
};

function Rows({
  items,
  emptyLabel,
}: {
  items: { id: string; slug: string; title: string; words: number; floor: number; reasons: string[] }[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-neutral-500">{emptyLabel}</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-neutral-200">
      {items.map((item) => (
        <li key={item.id} className="py-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <TextLink href={`/admin/content/${item.id}`}>{item.title}</TextLink>
            <span className="text-xs tabular-nums text-neutral-500">
              {item.words} words
              {item.words < item.floor && (
                <span className="text-amber-700"> · {item.floor - item.words} below its floor</span>
              )}
            </span>
            <Link
              href={`/articles/${item.slug}`}
              target="_blank"
              rel="noopener"
              className="text-xs text-neutral-400 underline hover:text-neutral-700"
            >
              view
            </Link>
          </div>
          {item.reasons.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5">
              {item.reasons.map((r) => (
                <li key={r} className="text-xs leading-relaxed text-neutral-600">
                  {r}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function QualityPage() {
  await requireAdmin();
  const overview = await getQualityOverview();
  const { totals, byVerdict } = overview;

  const floors = Object.entries(INTENT_FLOOR)
    .map(([type, n]) => `${type} ${n}`)
    .join(", ");

  return (
    <div>
      <PageHeader
        title="Content quality"
        description={
          `Every published piece, assessed against what its own format has to do. ` +
          `Word floors are per intent (${floors}; everything else ${DEFAULT_FLOOR}) — ` +
          `not a single site-wide number, because a 200-word news item is a news item.`
        }
      />

      {totals.published === 0 ? (
        <EmptyState
          title="Nothing published yet"
          description="This page assesses published content. Publish something and it will appear here."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">Where the corpus stands</h2>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Published", totals.published, "neutral"],
                ["Improve", byVerdict.IMPROVE.length, "amber"],
                ["Merge candidates", byVerdict.MERGE.length, "red"],
                ["Keep", byVerdict.KEEP.length, "green"],
                ["No sources", totals.sourceless, "red"],
                ["Generic hero", totals.genericHero, "amber"],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-xs text-neutral-500">{label}</dt>
                  <dd className="text-2xl font-semibold tabular-nums text-neutral-900">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {/* The three cross-cutting gaps. A piece can be KEEP on length and
              still be unsourced, so these are not a subset of any verdict — a
              reader who only worked the verdict columns would never see them. */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-neutral-900">No sources recorded</h2>
                <Badge tone="red">{totals.sourceless}</Badge>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-neutral-500">
                The public page shows no Sources section at all for these, which makes the gap
                visible to a reader. That is honest, and it is still a gap.
              </p>
              <Rows items={overview.sourceless} emptyLabel="Every published piece cites something." />
            </Card>

            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-neutral-900">Generic hero image</h2>
                <Badge tone="amber">{totals.genericHero}</Badge>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-neutral-500">
                Leads with a generated card rather than a photograph or a data graphic. A chart is
                not a generic hero — where the subject is the numbers, the chart is correct.
              </p>
              <Rows items={overview.genericHero} emptyLabel="No generated hero images remain." />
            </Card>

            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-neutral-900">No internal links</h2>
                <Badge tone="neutral">{totals.orphans}</Badge>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-neutral-500">
                Counted in both directions — a piece linked TO is not an orphan just because it did
                not do the linking.
              </p>
              <Rows items={overview.orphans} emptyLabel="Everything is connected to something." />
            </Card>
          </div>

          {VERDICT_ORDER.map((verdict) => (
            <Card key={verdict} className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-neutral-900">{verdict}</h2>
                <Badge tone={VERDICT_TONE[verdict]}>{byVerdict[verdict].length}</Badge>
              </div>
              <p className="mb-3 max-w-3xl text-xs leading-relaxed text-neutral-500">
                {VERDICT_NOTE[verdict]}
              </p>
              <Rows
                items={byVerdict[verdict]}
                emptyLabel={`Nothing currently assessed as ${verdict}.`}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
