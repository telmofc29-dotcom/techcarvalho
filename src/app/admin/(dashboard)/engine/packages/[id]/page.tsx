import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { PageHeader, Card, QueryErrorBanner } from "@/components/admin/ui";
import { Badge } from "@/components/shared/ui";
import { SubmitButton } from "@/components/admin/submit-button";
import { loadApprovalPackage } from "@/lib/engine/package-service";
import { MARKER_SYMBOL, type PackageMarker, type PackageLine } from "@/lib/engine/approval-package";
import { approveAndBuild, setBriefReviewState } from "../../actions";
import { EngineTabs } from "../../shared";

// THE APPROVAL PACKAGE — one screen, one decision.
//
// The page states every consequence of approving before asking, and it is
// explicit about the two things an owner most needs to know and would otherwise
// have to infer:
//
//   1. What already exists versus what this will CREATE. Those look alike on a
//      checklist and are opposite facts.
//   2. That approving does not publish. The build produces a draft and stops,
//      because the assembly RPC hard-wires status='draft' and cannot be argued
//      out of it. Saying so on the button and again underneath is cheaper than
//      an owner discovering it either way by accident.

export const dynamic = "force-dynamic";

export default async function ApprovalPackagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const load = await loadApprovalPackage(id);

  if (!load.ok) {
    // A missing brief is a 404. A failed READ is not — reporting a query
    // failure as "not found" would send the owner looking for a row that is
    // probably still there.
    if (load.reason.includes("no longer exists")) notFound();
    return (
      <div>
        <PageHeader title="Approval package" />
        <EngineTabs current="/admin/engine" />
        <QueryErrorBanner message={load.reason} />
      </div>
    );
  }

  const pkg = load.package;

  return (
    <div>
      <PageHeader
        title={pkg.title}
        description="Everything one approval will do. Nothing here is published."
      />
      <EngineTabs current="/admin/engine" />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone="green">{pkg.quality.label}</Badge>
        {pkg.contentType && <Badge tone="blue">{pkg.contentType}</Badge>}
        <span className="text-sm text-neutral-500">
          {pkg.quality.factCount} facts · {pkg.quality.sourceCount} sources ·{" "}
          {pkg.quality.independentDomains} independent publishers
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {pkg.sections.map((section) => (
          <Card key={section.title} className="p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
              {section.title}
            </h2>
            <ul className="space-y-2">
              {section.lines.map((line, i) => (
                <LineRow key={i} line={line} />
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card className="p-5 mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
          After building, you still do this
        </h2>
        <ol className="space-y-1.5 list-decimal list-inside">
          {pkg.afterBuild.map((step, i) => (
            <li key={i} className="text-sm text-neutral-700">
              {step}
            </li>
          ))}
        </ol>
      </Card>

      {!pkg.canBuild && (
        <div className="mt-6">
          <QueryErrorBanner
            message={`This cannot be built yet — ${pkg.blockers.join("; ")}.`}
          />
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {pkg.canBuild ? (
          <form action={approveAndBuild}>
            <input type="hidden" name="id" value={pkg.briefId} />
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

        <form action={setBriefReviewState}>
          <input type="hidden" name="id" value={pkg.briefId} />
          <input type="hidden" name="review_state" value="rejected" />
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
        Approving creates a draft and everything around it. It does not publish — the assembly step
        can only ever produce a draft, so publishing stays a separate action you take after reading
        it.
      </p>
    </div>
  );
}

const MARKER_STYLE: Record<PackageMarker, string> = {
  ok: "text-green-700",
  will_create: "text-blue-700",
  warn: "text-amber-700",
  blocked: "text-red-700",
};

function LineRow({ line }: { line: PackageLine }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className={`mt-0.5 font-semibold tabular-nums ${MARKER_STYLE[line.marker]}`}
      >
        {MARKER_SYMBOL[line.marker]}
      </span>
      <div className="min-w-0">
        <p className={`text-sm ${line.marker === "blocked" ? "text-red-700" : "text-neutral-800"}`}>
          {line.text}
        </p>
        {line.detail && <p className="mt-0.5 text-xs text-neutral-500">{line.detail}</p>}
      </div>
    </li>
  );
}
