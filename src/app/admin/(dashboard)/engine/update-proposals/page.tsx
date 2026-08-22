import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { classifyProposedChange, stripChangePrefix } from "@/lib/engine/update-signals";
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
import type { Database, EngineUpdateProposalState } from "@/lib/types/database";
import { setUpdateProposalState } from "../actions";
import {
  EngineTabs,
  ProposalConfidenceBadge,
  ProposalStateBadge,
  UpdateReasonBadge,
  formatDateTime,
  humanise,
} from "../shared";

// Phase 6 — update proposals.
//
// The problem this solves: new evidence about something already covered should
// change the existing page, not spawn a fourth thin article about the same
// camera. So the engine files a proposal against the existing record.
//
// The boundary this page holds: a proposal is an ARGUMENT, not an edit. The
// only writes available here change the proposal's own state and reason. The
// target article or product is never touched — accepting one is an editor
// saying "yes, that page should change", after which the editor changes it by
// hand on the record itself. 'applied' is a record that they did, not an
// instruction that made it happen.

const STATE_FILTERS: EngineUpdateProposalState[] = ["open", "accepted", "applied", "rejected"];

// supabase-js infers row shapes only from a single string literal, and this
// column list is too long for one — so the shape is taken from the schema type
// instead of being restated, and a renamed column fails at compile time.
const PROPOSAL_COLUMNS =
  "id, content_id, product_id, discovery_id, reason, summary, proposed_changes, evidence_urls, " +
  "confidence, state, state_reason, created_at, updated_at";

type ProposalRow = Database["public"]["Tables"]["engine_update_proposals"]["Row"];

type TargetRow =
  | { kind: "content"; id: string; label: string; href: string; live: boolean; liveLabel: string }
  | { kind: "product"; id: string; label: string; href: string; live: boolean; liveLabel: string };

export default async function EngineUpdateProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  await requireAdmin();
  const { state } = await searchParams;
  const supabase = await createClient();

  // The open queue is the default because it is the only one that represents
  // an outstanding decision.
  const activeState = STATE_FILTERS.find((s) => s === state) ?? "open";

  const { data: proposalData, error: proposalsError } = await supabase
    .from("engine_update_proposals")
    .select(PROPOSAL_COLUMNS)
    .eq("state", activeState)
    .order("confidence", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(200);

  const proposals = (proposalData ?? []) as unknown as ProposalRow[];

  const contentIds = proposals.map((p) => p.content_id).filter((id): id is string => !!id);
  const productIds = proposals.map((p) => p.product_id).filter((id): id is string => !!id);
  const discoveryIds = proposals.map((p) => p.discovery_id).filter((id): id is string => !!id);

  const [
    { data: contentRows, error: contentError },
    { data: productRows, error: productsError },
    { data: discoveryRows, error: discoveriesError },
    { data: stateRows, error: countsError },
  ] = await Promise.all([
    contentIds.length > 0
      ? supabase.from("content_items").select("id, title, slug, status").in("id", contentIds)
      : Promise.resolve({ data: [] as { id: string; title: string; slug: string; status: string }[], error: null }),
    productIds.length > 0
      ? supabase.from("products").select("id, name, slug, is_published").in("id", productIds)
      : Promise.resolve({
          data: [] as { id: string; name: string; slug: string; is_published: boolean }[],
          error: null,
        }),
    discoveryIds.length > 0
      ? supabase.from("engine_discoveries").select("id, title, claim_status").in("id", discoveryIds)
      : Promise.resolve({ data: [] as { id: string; title: string; claim_status: string }[], error: null }),
    supabase.from("engine_update_proposals").select("state"),
  ]);

  const contentById = new Map((contentRows ?? []).map((c) => [c.id, c]));
  const productById = new Map((productRows ?? []).map((p) => [p.id, p]));
  const discoveryById = new Map((discoveryRows ?? []).map((d) => [d.id, d]));

  const counts = new Map<string, number>();
  for (const r of (stateRows ?? []) as { state: string }[]) {
    counts.set(r.state, (counts.get(r.state) ?? 0) + 1);
  }

  const anyError = proposalsError || contentError || productsError || discoveriesError;

  return (
    <div>
      <PageHeader
        title="Update proposals"
        description="Evidence that an EXISTING page should change. Each proposal targets one article or product and carries the sources behind the claim."
      />
      <EngineTabs current="/admin/engine/update-proposals" />

      <Card className="p-4 mb-6 border-blue-200 bg-blue-50">
        <p className="text-sm font-medium text-neutral-900">A proposal is an argument, not an edit</p>
        <p className="text-xs text-neutral-700 mt-1">
          Deciding on a proposal changes the proposal and nothing else. <strong>Accepted</strong> means an editor agrees
          the target page should change; the page is unchanged until someone edits it on its own record.{" "}
          <strong>Applied</strong> is a record that they since did. Neither state edits, republishes, or re-verifies the
          target, and no proposal can alter a published page on its own.
        </p>
      </Card>

      <div className="flex flex-wrap gap-2 mb-4">
        {STATE_FILTERS.map((s) => (
          <a
            key={s}
            href={`/admin/engine/update-proposals?state=${s}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              activeState === s ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
            }`}
          >
            {humanise(s)}
            {!countsError && counts.has(s) ? ` (${counts.get(s)})` : ""}
          </a>
        ))}
      </div>

      {proposalsError && <QueryErrorBanner message={`Failed to load update proposals: ${proposalsError.message}`} />}
      {contentError && <QueryErrorBanner message={`Failed to load the targeted articles: ${contentError.message}`} />}
      {productsError && <QueryErrorBanner message={`Failed to load the targeted products: ${productsError.message}`} />}
      {discoveriesError && (
        <QueryErrorBanner message={`Failed to load the originating discoveries: ${discoveriesError.message}`} />
      )}
      {countsError && <QueryErrorBanner message={`Failed to load queue counts: ${countsError.message}`} />}

      {!anyError && proposals.length === 0 ? (
        <EmptyState
          title={`No ${humanise(activeState).toLowerCase()} proposals`}
          description="Proposals appear here when the engine finds evidence that something already covered has changed."
        />
      ) : (
        !anyError && (
          <div className="flex flex-col gap-3">
            {proposals.map((p) => {
              const content = p.content_id ? (contentById.get(p.content_id) ?? null) : null;
              const product = p.product_id ? (productById.get(p.product_id) ?? null) : null;
              const discovery = p.discovery_id ? (discoveryById.get(p.discovery_id) ?? null) : null;

              let target: TargetRow | null = null;
              if (content) {
                target = {
                  kind: "content",
                  id: content.id,
                  label: content.title,
                  href: `/admin/content/${content.id}`,
                  live: content.status === "published",
                  liveLabel: humanise(content.status),
                };
              } else if (product) {
                target = {
                  kind: "product",
                  id: product.id,
                  label: product.name,
                  href: `/admin/products/${product.id}`,
                  live: product.is_published,
                  liveLabel: product.is_published ? "Published" : "Unpublished",
                };
              }

              // The prefixes are written by proposedChanges(); anything that
              // does not carry one is shown as unclassified rather than being
              // quietly filed under verified.
              const verified = p.proposed_changes.filter((c) => classifyProposedChange(c) === "verified");
              const unverified = p.proposed_changes.filter((c) => classifyProposedChange(c) === "unverified");
              const unclassified = p.proposed_changes.filter((c) => classifyProposedChange(c) === "unclassified");

              return (
                <Card key={p.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-900">
                        {target ? (
                          <TextLink href={target.href}>{target.label}</TextLink>
                        ) : (
                          // Never render a proposal with no target as if it had
                          // one: this is a real data problem, not a blank field.
                          <span className="text-red-700">
                            Target record could not be read (
                            {p.content_id ? `content ${p.content_id}` : `product ${p.product_id ?? "unknown"}`})
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {target ? (target.kind === "content" ? "Article" : "Product") : "Unknown target"}
                        {target ? ` · ${target.liveLabel}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <UpdateReasonBadge reason={p.reason} />
                      <ProposalConfidenceBadge confidence={p.confidence} />
                      <ProposalStateBadge state={p.state} />
                      {target?.live && <Badge tone="amber">Live page</Badge>}
                    </div>
                  </div>

                  <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3">
                    <p className="text-xs font-semibold text-neutral-900">Why the engine proposed this</p>
                    <p className="text-xs text-neutral-700 mt-1 whitespace-pre-line">{p.summary}</p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 mt-3">
                    <div className="rounded border border-green-200 bg-green-50 p-3">
                      <p className="text-xs font-semibold text-neutral-900">
                        Verified — may be stated directly ({verified.length})
                      </p>
                      {verified.length === 0 ? (
                        <p className="text-xs text-neutral-600 mt-1">
                          Nothing here is primary-confirmed. Any edit made from this proposal must be attributed, not
                          stated as fact.
                        </p>
                      ) : (
                        <ul className="list-disc list-inside text-xs text-neutral-800 mt-1 space-y-1">
                          {verified.map((c, i) => (
                            <li key={i}>{stripChangePrefix(c)}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div
                      className={`rounded border p-3 ${
                        unverified.length > 0 ? "border-red-300 bg-red-50" : "border-neutral-200 bg-neutral-50"
                      }`}
                    >
                      <p className="text-xs font-semibold text-neutral-900">
                        Unverified — attribute or omit ({unverified.length})
                      </p>
                      {unverified.length === 0 ? (
                        <p className="text-xs text-neutral-600 mt-1">No unverified claims in this proposal.</p>
                      ) : (
                        <ul className="list-disc list-inside text-xs text-red-900 mt-1 space-y-1">
                          {unverified.map((c, i) => (
                            <li key={i}>{stripChangePrefix(c)}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {unclassified.length > 0 && (
                    <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3">
                      <p className="text-xs font-semibold text-neutral-900">
                        Evidence quality not recorded ({unclassified.length})
                      </p>
                      <p className="text-[11px] text-neutral-700 mt-0.5">
                        These lines carry no verified/unverified marker, so their standing is unknown. Treat them as
                        unverified until checked against the sources below.
                      </p>
                      <ul className="list-disc list-inside text-xs text-neutral-800 mt-1 space-y-1">
                        {unclassified.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {p.proposed_changes.length === 0 && (
                    <p className="text-xs text-amber-800 mt-3">
                      No specific changes were recorded on this proposal — only the summary above.
                    </p>
                  )}

                  {p.evidence_urls.length > 0 ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-medium text-neutral-700">
                        Evidence ({p.evidence_urls.length})
                      </summary>
                      <ul className="flex flex-col gap-1 mt-2">
                        {p.evidence_urls.map((u) => (
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
                  ) : (
                    <p className="text-xs text-amber-800 mt-3">
                      No evidence URLs attached. There is nothing here to check a published page against.
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-neutral-400">
                    <span>
                      Created {formatDateTime(p.created_at)} · updated {formatDateTime(p.updated_at)}
                    </span>
                    {discovery && (
                      <span>
                        From discovery: {discovery.title} ({humanise(discovery.claim_status)})
                      </span>
                    )}
                    {p.discovery_id && !discovery && <span>Originating discovery could not be read.</span>}
                  </div>

                  {p.state_reason && <p className="text-xs text-neutral-600 mt-1">Decision note: {p.state_reason}</p>}

                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-neutral-700">Record a decision</summary>
                    <form action={setUpdateProposalState} className="flex flex-col gap-3 mt-3 max-w-md">
                      <input type="hidden" name="id" value={p.id} />
                      <Field
                        label="Decision"
                        htmlFor={`state-${p.id}`}
                        hint="This changes the proposal only. The target page is never edited from here."
                      >
                        <Select id={`state-${p.id}`} name="state" defaultValue="accepted">
                          <option value="accepted">Accept — the page should change</option>
                          <option value="applied">Applied — I have made the change</option>
                          <option value="rejected">Reject — no change needed</option>
                        </Select>
                      </Field>
                      <Field
                        label="Reason"
                        htmlFor={`reason-${p.id}`}
                        hint="Why you decided this, for whoever reads the page's history next."
                      >
                        <TextInput id={`reason-${p.id}`} name="state_reason" defaultValue="" />
                      </Field>
                      <div>
                        <SubmitButton pendingLabel="Saving...">Save decision</SubmitButton>
                      </div>
                    </form>
                  </details>
                </Card>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
