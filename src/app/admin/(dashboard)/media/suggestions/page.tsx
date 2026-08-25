import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { PageHeader, Card, QueryErrorBanner } from "@/components/admin/ui";
import { Badge } from "@/components/shared/ui";
import { SubmitButton } from "@/components/admin/submit-button";
import { loadAssetSuggestions, loadMediaNeeds } from "@/lib/media/suggestion-service";
import { NATURE_LABELS, type MediaMatch } from "@/lib/media/match-engine";
import { applyMediaSuggestion } from "../actions";

// THE MEDIA SUGGESTION QUEUE — both directions on one screen.
//
// MEDIA -> CONTENT: an image that is doing nothing, and where it could go.
// CONTENT -> MEDIA: a page with no lead image, and what could fill it.
//
// They are the same question from opposite ends and share one scorer, so the
// two halves can never disagree about a pairing.
//
// WHAT ONE APPROVAL DOES
// ----------------------
// Classifies the asset if it is unclassified, saves the proposed alt text if it
// has none, attaches it to the target, and fills the slots shown on the row.
// That is the whole sequence that previously meant opening the asset, the
// target, and the association screen in turn.
//
// WHAT IT NEVER DOES
// ------------------
// Publish. An asset stays private until somebody says otherwise, because
// publishing is the step with consequences outside the admin. And it never
// fills a slot that is already occupied — the matcher withholds those, with
// the reason printed on the row, so an existing choice is replaced only by
// somebody who went and did it deliberately.

export const dynamic = "force-dynamic";

export default async function MediaSuggestionsPage() {
  await requireAdmin();
  const [{ suggestions, failures }, { needs, failures: needFailures }] = await Promise.all([
    loadAssetSuggestions({ limit: 40 }),
    loadMediaNeeds({ limit: 30 }),
  ]);

  const allFailures = [...new Set([...failures, ...needFailures])];
  const unattached = suggestions.filter((s) => s.unattached);

  return (
    <div>
      <PageHeader
        title="Media suggestions"
        description="Where unused images belong, and which pages still need one."
        action={
          <Link
            href="/admin/media"
            className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-neutral-700 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50"
          >
            Media library
          </Link>
        }
      />

      {allFailures.length > 0 && (
        <QueryErrorBanner
          message={`This list is INCOMPLETE — ${allFailures.join("; ")}. Treat it as partial, not as empty.`}
        />
      )}

      <div className="mb-6 flex flex-wrap gap-x-8 gap-y-2">
        <Stat n={suggestions.length} label="images with a safe target" />
        <Stat n={unattached.length} label="of those currently unused" />
        <Stat n={needs.length} label="pages needing an image" />
        <Stat n={needs.filter((x) => x.candidates.length > 0).length} label="of those already answerable" />
      </div>

      {/* ---------------- MEDIA -> CONTENT ---------------- */}
      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
        Images looking for a home
      </h2>
      {suggestions.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-neutral-600">
            No image in the library has a target the matcher considers safe. That is a real answer,
            not an error — a suggestion is only offered when the image&rsquo;s own filename, alt text
            or caption identifies the subject.
          </p>
        </Card>
      ) : (
        <div className="space-y-4 mb-10">
          {suggestions.slice(0, 25).map((s) => (
            <Card key={s.asset.id} className="p-5">
              <div className="flex flex-wrap items-baseline gap-2 mb-2">
                <Badge tone={s.nature === "owner_photograph" ? "green" : s.nature === "concept_render" ? "amber" : "neutral"}>
                  {NATURE_LABELS[s.nature]}
                </Badge>
                {s.unattached && <Badge tone="blue">Unused</Badge>}
                <Link
                  href={`/admin/media/${s.asset.id}`}
                  className="font-mono text-sm text-neutral-900 underline underline-offset-4"
                >
                  {fileName(s.asset.storagePath)}
                </Link>
                {!s.asset.altText && (
                  <span className="text-xs text-amber-700">no alt text</span>
                )}
              </div>

              {s.proposedAlt && (
                <p className="mb-3 text-sm text-neutral-600">
                  <span className="text-neutral-400">Proposed alt:</span> {s.proposedAlt}
                </p>
              )}

              <ul className="space-y-3">
                {s.matches.map((m) => (
                  <MatchRow key={`${m.target.kind}:${m.target.id}`} assetId={s.asset.id} match={m} alt={s.proposedAlt} />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {/* ---------------- CONTENT -> MEDIA ---------------- */}
      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
        Pages needing an image
      </h2>
      <div className="space-y-4">
        {needs.slice(0, 20).map((n) => (
          <Card key={`${n.target.kind}:${n.target.id}`} className="p-5">
            <div className="flex flex-wrap items-baseline gap-2 mb-1">
              <Badge tone="neutral">{n.target.kind}</Badge>
              <span className="text-sm font-medium text-neutral-900">{n.target.title}</span>
              <span className="text-xs text-amber-700">{n.reason}</span>
            </div>

            {n.candidates.length > 0 ? (
              <ul className="mt-2 space-y-3">
                {n.candidates.map((m) => (
                  <MatchRow key={m.assetId} assetId={m.assetId} match={m} alt={null} showAsset />
                ))}
              </ul>
            ) : (
              <div className="mt-2 rounded border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-1">
                  Nothing in the library fits — this is what to make
                </p>
                <p className="text-sm text-neutral-700">{n.briefForNewImage}</p>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <p className="text-2xl font-semibold tabular-nums text-neutral-900">{n}</p>
      <p className="text-sm text-neutral-500 mt-0.5">{label}</p>
    </div>
  );
}

function fileName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/^[0-9a-f-]{36}-/i, "");
}

function MatchRow({
  assetId,
  match,
  alt,
  showAsset = false,
}: {
  assetId: string;
  match: MediaMatch;
  alt: string | null;
  showAsset?: boolean;
}) {
  const tone = match.strength === "high" ? "green" : match.strength === "medium" ? "blue" : "neutral";
  return (
    <li className="border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge tone={tone}>{match.strength}</Badge>
        <Badge tone={match.specificity === "exact_model" ? "green" : "amber"}>
          {match.specificity.replace(/_/g, " ")}
        </Badge>
        <span className="text-sm text-neutral-900">
          {showAsset ? fileName(match.assetId) : match.target.title}
        </span>
      </div>

      <ul className="mt-1 space-y-0.5">
        {match.reasons.map((r, i) => (
          <li key={i} className="text-xs text-neutral-500">
            {r}
          </li>
        ))}
        {match.withheld.map((r, i) => (
          <li key={`w${i}`} className="text-xs text-amber-700">
            {r}
          </li>
        ))}
      </ul>

      {match.proposedSlots.length > 0 && (
        <form action={applyMediaSuggestion} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="media_id" value={assetId} />
          <input type="hidden" name="target_kind" value={match.target.kind} />
          <input type="hidden" name="target_id" value={match.target.id} />
          <input type="hidden" name="slots" value={match.proposedSlots.join(",")} />
          {alt && <input type="hidden" name="alt_text" value={alt} />}
          <SubmitButton>Attach as {match.proposedSlots.join(" + ")}</SubmitButton>
        </form>
      )}
    </li>
  );
}
