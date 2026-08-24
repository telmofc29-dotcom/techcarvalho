import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { PageHeader, Card } from "@/components/admin/ui";
import { Badge } from "@/components/shared/ui";
import { SubmitButton } from "@/components/admin/submit-button";
import { loadResearchedTopic } from "@/lib/engine/research-topic-service";
import { approveResearchedTopic, rejectResearchedTopic } from "../../actions";
import { EngineTabs } from "../../shared";

// ONE RESEARCHED TOPIC, ONE PACKAGE, ONE DECISION.
//
// Everything the owner needs in order to say yes or no to a subject: who is
// reporting it, how many of those are genuinely independent, what was actually
// claimed, which claims stayed unconfirmed, and what would be built.
//
// The two things this page refuses to blur:
//
//   1. ORIGINS versus URLS. Four links can be one voice. The collapsed ones are
//      listed with the reason, so "4 sources" can never quietly mean "one story
//      repeated four times".
//
//   2. ARTICLE versus PRODUCT. They have different bars and are shown as
//      separate verdicts. Rumours can justify a well-framed article long before
//      they justify a catalogue page asserting a product exists.

export const dynamic = "force-dynamic";

export default async function ResearchedTopicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const topic = await loadResearchedTopic(id);
  if (!topic) notFound();

  const framingTone =
    topic.framing === "confirmed" ? "green" : topic.framing === "reported" ? "blue" : "amber";

  return (
    <div>
      <PageHeader
        title={topic.suggestedTitle ?? topic.title}
        description="One researched topic. Approving assembles a draft — it does not publish."
      />
      <EngineTabs current="/admin/engine" />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={framingTone}>{topic.framing.toUpperCase()}</Badge>
        <span className="text-sm text-neutral-500">
          {topic.independentOrigins} independent origin
          {topic.independentOrigins === 1 ? "" : "s"} · {topic.claimsTotal} claims ·{" "}
          {topic.evidence.length} sources
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---- why now ---- */}
        <Card className="p-5">
          <H>Why now</H>
          <p className="text-sm text-neutral-700">
            {topic.publishers.slice(0, 5).join(", ")}
            {topic.publishers.length > 5 ? " and others" : ""} are covering this and TechCarvalho is
            not.
          </p>
          {topic.corpusKnown ? (
            <p className="mt-2 text-sm text-green-700">
              Checked against published content — no existing page covers it.
            </p>
          ) : (
            <p className="mt-2 text-sm text-amber-700">
              Existing coverage could NOT be checked, so no duplication clearance is claimed.
            </p>
          )}
        </Card>

        {/* ---- research ---- */}
        <Card className="p-5">
          <H>Research</H>
          <ul className="space-y-1.5 text-sm">
            <Li tone="good">
              {topic.independentOrigins} independent origin
              {topic.independentOrigins === 1 ? "" : "s"} across {topic.evidence.length} sources
            </Li>
            <Li tone="good">{topic.claimsTotal} atomic claims extracted</Li>
            <Li tone="neutral">{topic.claimsAttributed} attributed to a named source</Li>
            <Li tone={topic.claimsHedged > 0 ? "neutral" : "warn"}>
              {topic.claimsHedged} kept explicitly unconfirmed
            </Li>
            <Li tone="neutral">{topic.claimsWithValues} carry a checkable figure or date</Li>
          </ul>
          {topic.collapsed.length > 0 && (
            <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                {topic.collapsed.length} source(s) added no independent voice
              </p>
              <ul className="mt-1.5 space-y-1">
                {topic.collapsed.map((c, i) => (
                  <li key={i} className="text-xs text-amber-800">
                    {c.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {/* ---- recommendation ---- */}
        <Card className="p-5">
          <H>Recommendation</H>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2">
              <Mark ok={topic.articleEligible} />
              <span>
                <strong>Article:</strong> {topic.articleEligible ? "YES" : "NO"}
              </span>
            </li>
            <li className="flex gap-2">
              <Mark ok={topic.productEligible} />
              <span>
                <strong>Product page:</strong> {topic.productEligible ? "YES" : "NO"}
              </span>
            </li>
          </ul>
          <ul className="mt-3 space-y-1">
            {topic.reasons.map((r, i) => (
              <li key={i} className="text-xs text-neutral-500">
                {r}
              </li>
            ))}
          </ul>
          {topic.suggestedTitle && (
            <p className="mt-3 text-sm">
              <span className="text-neutral-500">Suggested title:</span>{" "}
              <span className="text-neutral-900">{topic.suggestedTitle}</span>
            </p>
          )}
        </Card>

        {/* ---- sources ---- */}
        <Card className="p-5">
          <H>Sources</H>
          <ul className="space-y-2">
            {topic.evidence.map((e, i) => (
              <li key={i} className="text-sm">
                <span className="text-neutral-900">{e.publisher ?? "Unknown publisher"}</span>
                {e.originatesFrom && (
                  <span className="ml-2 text-xs text-amber-700">
                    repeats {e.originatesFrom}
                  </span>
                )}
                <br />
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-neutral-500 underline underline-offset-2 break-all"
                >
                  {e.url}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* ---- claims ---- */}
      {topic.sampleClaims.length > 0 && (
        <Card className="p-5 mt-4">
          <H>What was actually claimed</H>
          <ul className="space-y-2">
            {topic.sampleClaims.map((c, i) => (
              <li key={i} className="text-sm">
                {c.hedges.length > 0 && (
                  <Badge tone="amber">unconfirmed: {c.hedges.join(", ")}</Badge>
                )}
                {c.attributedTo && !c.hedges.length && <Badge tone="blue">{c.attributedTo}</Badge>}
                <span className="ml-2 text-neutral-700">{c.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-neutral-500 max-w-prose">
            Hedged claims stay hedged in the assembled draft. Nothing marked unconfirmed above can
            be written as established fact.
          </p>
        </Card>
      )}

      {/* ---- actions ---- */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {topic.articleEligible ? (
          <form action={approveResearchedTopic}>
            <input type="hidden" name="discovery_id" value={topic.discoveryId} />
            <SubmitButton pendingLabel="Building...">Approve &amp; build</SubmitButton>
          </form>
        ) : (
          <button
            type="button"
            disabled
            className="rounded px-3 py-2 text-sm font-medium bg-neutral-200 text-neutral-500 cursor-not-allowed"
          >
            Approve &amp; build
          </button>
        )}
        <form action={rejectResearchedTopic}>
          <input type="hidden" name="discovery_id" value={topic.discoveryId} />
          <SubmitButton variant="secondary">Reject</SubmitButton>
        </form>
        <Link
          href="/admin/engine"
          className="text-sm font-medium text-neutral-600 underline underline-offset-4 hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        >
          Back to Today
        </Link>
      </div>

      <p className="mt-3 text-sm text-neutral-500 max-w-prose">
        Approving creates a brief and assembles a draft from this evidence. It does not publish —
        assembly can only ever produce a draft, so publishing stays a separate action you take after
        reading it.
      </p>
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
      {children}
    </h2>
  );
}

function Li({ children, tone }: { children: React.ReactNode; tone: "good" | "warn" | "neutral" }) {
  const colour =
    tone === "good" ? "text-green-700" : tone === "warn" ? "text-amber-700" : "text-neutral-500";
  return (
    <li className="flex gap-2">
      <span aria-hidden className={colour}>
        •
      </span>
      <span className="text-neutral-700">{children}</span>
    </li>
  );
}

function Mark({ ok }: { ok: boolean }) {
  return (
    <span aria-hidden className={ok ? "text-green-700 font-semibold" : "text-red-700 font-semibold"}>
      {ok ? "✓" : "✗"}
    </span>
  );
}
