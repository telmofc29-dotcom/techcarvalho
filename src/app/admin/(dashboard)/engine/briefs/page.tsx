import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader,
  Card,
  Badge,
  Field,
  Select,
  TextInput,
  TextLink,
  EmptyState,
  QueryErrorBanner,
} from "@/components/admin/ui";
import { SubmitButton } from "@/components/admin/submit-button";
import { setBriefReviewState } from "../actions";
import {
  BriefKindBadge,
  EngineTabs,
  FreshnessSensitivityBadge,
  ReviewStateBadge,
  StateBadge,
  formatDateTime,
  humanise,
} from "../shared";

// The human review queue — the gate between what the engine proposes and what
// anyone actually writes. Approving here means "a human agrees this is worth
// covering"; it does not create content and cannot publish anything.

const REVIEW_STATE_FILTERS = [
  "pending",
  "approved",
  "research_requested",
  "snoozed",
  "rejected",
] as const;

const KIND_FILTERS = [
  "",
  "breaking",
  "evergreen",
  "product",
  "comparison",
  "troubleshooting",
  "buying_guide",
  "explainer",
  "update_existing",
] as const;

type BriefRow = {
  id: string;
  proposed_title: string;
  proposed_slug: string | null;
  content_type: string | null;
  search_intent: string | null;
  primary_query: string | null;
  category_slug: string | null;
  rationale: string;
  related_product_slugs: string[];
  related_content_slugs: string[];
  media_requirement_note: string | null;
  state: string;
  state_reason: string | null;
  content_id: string | null;
  created_at: string;
  primary_question: string | null;
  supporting_questions: string[];
  verified_facts: string[];
  uncertainties: string[];
  source_urls: string[];
  suggested_structure: string[];
  freshness_sensitivity: string | null;
  brief_kind: string | null;
  priority: number | null;
  review_state: string;
  review_note: string | null;
  snoozed_until: string | null;
  reviewed_at: string | null;
};

const SELECT_COLUMNS =
  "id, proposed_title, proposed_slug, content_type, search_intent, primary_query, category_slug, " +
  "rationale, related_product_slugs, related_content_slugs, media_requirement_note, state, state_reason, " +
  "content_id, created_at, primary_question, supporting_questions, verified_facts, uncertainties, " +
  "source_urls, suggested_structure, freshness_sensitivity, brief_kind, priority, review_state, " +
  "review_note, snoozed_until, reviewed_at";

export default async function EngineBriefsPage({
  searchParams,
}: {
  searchParams: Promise<{ review?: string; kind?: string }>;
}) {
  await requireAdmin();
  const { review, kind } = await searchParams;
  const supabase = await createClient();

  // Default to the pending queue: the point of this page is the decisions
  // still waiting on a human.
  const activeReview = REVIEW_STATE_FILTERS.find((s) => s === review) ?? "pending";

  let query = supabase
    .from("engine_briefs")
    .select(SELECT_COLUMNS)
    .eq("review_state", activeReview)
    // Highest priority first; briefs with no priority sort last rather than
    // as if they were zero.
    .order("priority", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  const validKind = KIND_FILTERS.find((k) => k !== "" && k === kind);
  if (validKind) query = query.eq("brief_kind", validKind);

  const { data, error } = await query;
  const rows = (data ?? []) as unknown as BriefRow[];

  // Queue counts per review state, so an admin can see what is waiting without
  // clicking through every filter.
  const { data: allStates, error: countsError } = await supabase
    .from("engine_briefs")
    .select("review_state");
  const counts = new Map<string, number>();
  for (const r of (allStates ?? []) as { review_state: string }[]) {
    counts.set(r.review_state, (counts.get(r.review_state) ?? 0) + 1);
  }

  const filterHref = (nextReview: string, nextKind: string) => {
    const params = new URLSearchParams();
    if (nextReview) params.set("review", nextReview);
    if (nextKind) params.set("kind", nextKind);
    const qs = params.toString();
    return `/admin/engine/briefs${qs ? `?${qs}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="Review queue"
        description="Structured briefs awaiting a human decision. A brief is a proposal — approving one means it is worth writing, not that anything has been written or published."
      />
      <EngineTabs current="/admin/engine/briefs" />

      <Card className="p-4 mb-6 border-blue-200 bg-blue-50">
        <p className="text-sm font-medium text-neutral-900">Nothing here is content</p>
        <p className="text-xs text-neutral-700 mt-1">
          Approving a brief records an editorial decision. It does not create a content record, does not publish, and
          does not touch media rights. Writing the article remains a separate, manual step through the normal editorial
          workflow, and the resulting record still has to pass the media-first gate like any other.
        </p>
      </Card>

      <div className="flex flex-col gap-2 mb-4">
        <div className="flex flex-wrap gap-2">
          {REVIEW_STATE_FILTERS.map((f) => (
            <a
              key={f}
              href={filterHref(f, kind ?? "")}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                activeReview === f ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {humanise(f)}
              {counts.has(f) ? ` (${counts.get(f)})` : ""}
            </a>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {KIND_FILTERS.map((f) => (
            <a
              key={f || "all"}
              href={filterHref(activeReview, f)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                (kind ?? "") === f ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {f ? humanise(f) : "All kinds"}
            </a>
          ))}
        </div>
      </div>

      {error && <QueryErrorBanner message={`Failed to load briefs: ${error.message}`} />}
      {countsError && <QueryErrorBanner message={`Failed to load queue counts: ${countsError.message}`} />}

      {!error && rows.length === 0 ? (
        <EmptyState
          title={`Nothing ${humanise(activeReview).toLowerCase()}`}
          description="Briefs appear here once the engine's brief stage runs against relevant discoveries."
        />
      ) : (
        !error && (
          <div className="flex flex-col gap-3">
            {rows.map((b) => (
              <Card key={b.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900">{b.proposed_title}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {b.content_type ? humanise(b.content_type) : "Type not set"}
                      {b.category_slug ? ` · ${b.category_slug}` : ""}
                      {b.search_intent ? ` · ${humanise(b.search_intent)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <BriefKindBadge kind={b.brief_kind} />
                    <FreshnessSensitivityBadge value={b.freshness_sensitivity} />
                    {b.priority !== null && <Badge tone="neutral">priority {b.priority}</Badge>}
                    <ReviewStateBadge state={b.review_state} />
                    <StateBadge state={b.state} />
                  </div>
                </div>

                {/* The rationale is the engine's "why this matters" — surfaced
                    prominently rather than buried, because it is the thing an
                    admin is actually judging. */}
                <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3">
                  <p className="text-xs font-semibold text-neutral-900">Why the engine proposed this</p>
                  <p className="text-xs text-neutral-700 mt-1">{b.rationale}</p>
                </div>

                {b.primary_question && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-neutral-900">Primary question</p>
                    <p className="text-sm text-neutral-700 mt-0.5">{b.primary_question}</p>
                  </div>
                )}

                {b.supporting_questions.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-semibold text-neutral-900">Supporting questions</p>
                    <ul className="list-disc list-inside text-xs text-neutral-700 mt-1 space-y-0.5">
                      {b.supporting_questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Verified vs uncertain, deliberately rendered as two visually
                    different things. Uncertainties are styled as warnings, not
                    footnotes — they are what stops an unconfirmed claim being
                    written up as established fact. */}
                <div className="grid gap-3 md:grid-cols-2 mt-3">
                  <div className="rounded border border-green-200 bg-green-50 p-3">
                    <p className="text-xs font-semibold text-neutral-900">
                      Verified facts ({b.verified_facts.length})
                    </p>
                    {b.verified_facts.length === 0 ? (
                      <p className="text-xs text-neutral-600 mt-1">
                        Nothing is primary-confirmed. Everything in this brief must be written as an attributed claim.
                      </p>
                    ) : (
                      <ul className="list-disc list-inside text-xs text-neutral-800 mt-1 space-y-1">
                        {b.verified_facts.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div
                    className={`rounded border p-3 ${
                      b.uncertainties.length > 0 ? "border-red-300 bg-red-50" : "border-neutral-200 bg-neutral-50"
                    }`}
                  >
                    <p className="text-xs font-semibold text-neutral-900">
                      Uncertainties ({b.uncertainties.length})
                    </p>
                    {b.uncertainties.length === 0 ? (
                      <p className="text-xs text-neutral-600 mt-1">No recorded uncertainties.</p>
                    ) : (
                      <ul className="list-disc list-inside text-xs text-red-900 mt-1 space-y-1">
                        {b.uncertainties.map((u, i) => (
                          <li key={i}>{u}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {b.suggested_structure.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-neutral-900">Suggested structure</p>
                    <ol className="list-decimal list-inside text-xs text-neutral-700 mt-1 space-y-0.5">
                      {b.suggested_structure.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {b.source_urls.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-neutral-700">
                      Sources ({b.source_urls.length})
                    </summary>
                    <ul className="flex flex-col gap-1 mt-2">
                      {b.source_urls.map((u) => (
                        <li key={u} className="text-xs break-all">
                          <a
                            href={u}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent underline hover:text-neutral-900"
                          >
                            {u}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {(b.related_product_slugs.length > 0 || b.related_content_slugs.length > 0) && (
                  <div className="mt-3 text-xs text-neutral-600">
                    {b.related_product_slugs.length > 0 && (
                      <p>Related products: {b.related_product_slugs.join(", ")}</p>
                    )}
                    {b.related_content_slugs.length > 0 && (
                      <p>Related content: {b.related_content_slugs.join(", ")}</p>
                    )}
                  </div>
                )}

                {b.media_requirement_note && (
                  <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-neutral-900">Media requirement</p>
                    <p className="text-xs text-neutral-700 mt-0.5">{b.media_requirement_note}</p>
                  </div>
                )}

                {b.primary_query && <p className="text-xs text-neutral-500 mt-3">Target query: {b.primary_query}</p>}
                {b.proposed_slug && <p className="text-xs text-neutral-500 mt-1">Proposed slug: {b.proposed_slug}</p>}
                {b.state_reason && <p className="text-xs text-neutral-500 mt-1">State reason: {b.state_reason}</p>}
                {b.review_note && (
                  <p className="text-xs text-neutral-600 mt-1">Review note: {b.review_note}</p>
                )}
                {b.snoozed_until && (
                  <p className="text-xs text-neutral-600 mt-1">Snoozed until {formatDateTime(b.snoozed_until)}</p>
                )}

                <div className="flex flex-wrap items-center gap-3 mt-3">
                  {b.content_id ? (
                    <TextLink href={`/admin/content/${b.content_id}`}>Open the content record</TextLink>
                  ) : (
                    <span className="text-xs text-neutral-400">No content record created from this yet.</span>
                  )}
                  <span className="text-[11px] text-neutral-400">
                    Created {formatDateTime(b.created_at)}
                    {b.reviewed_at ? ` · reviewed ${formatDateTime(b.reviewed_at)}` : ""}
                  </span>
                </div>

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-neutral-700">Review decision</summary>
                  <form action={setBriefReviewState} className="flex flex-col gap-3 mt-3 max-w-md">
                    <input type="hidden" name="id" value={b.id} />
                    <Field label="Decision" htmlFor={`review-${b.id}`}>
                      <Select id={`review-${b.id}`} name="review_state" defaultValue={b.review_state}>
                        <option value="approved">Approve</option>
                        <option value="rejected">Reject</option>
                        <option value="snoozed">Snooze</option>
                        <option value="research_requested">Request research</option>
                        <option value="pending">Back to pending</option>
                      </Select>
                    </Field>
                    <Field
                      label="Snooze for (days)"
                      htmlFor={`snooze-${b.id}`}
                      hint="Only used when the decision is Snooze."
                    >
                      <TextInput
                        id={`snooze-${b.id}`}
                        name="snooze_days"
                        type="number"
                        min={1}
                        max={365}
                        defaultValue={7}
                        className="w-24"
                      />
                    </Field>
                    <Field label="Note" htmlFor={`note-${b.id}`} hint="Why you decided this, for whoever looks next.">
                      <TextInput id={`note-${b.id}`} name="review_note" defaultValue={b.review_note ?? ""} />
                    </Field>
                    <div>
                      <SubmitButton pendingLabel="Saving...">Save decision</SubmitButton>
                    </div>
                  </form>
                </details>
              </Card>
            ))}
          </div>
        )
      )}
    </div>
  );
}
