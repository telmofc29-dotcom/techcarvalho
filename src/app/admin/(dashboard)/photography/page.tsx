import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import {
  getPhotographyOverview,
  CURRENT_MEDIA_LABEL,
  type PhotographyItem,
} from "@/lib/admin/photography-service";
import { assessmentHeadline } from "@/lib/media/photography-triage";
import { ACCESS_LABEL, type OwnerAccess } from "@/lib/media/resolution";
import { BASE_SHOT_LIST, type PhotoRequestPriority } from "@/lib/media/photo-requests";
import { PageHeader, Card, Badge, EmptyState, TextLink } from "@/components/admin/ui";
import { AccessControl } from "./access-control";

// The shooting list and the access triage, on one screen.
//
// WHY THEY ARE THE SAME SCREEN
// ----------------------------
// The ranking (src/lib/media/photo-requests.ts) answers "which photograph would
// improve the most pages". It cannot answer "can anyone actually take it" —
// that is a fact about the world that only a person can supply, and with all 44
// products recorded as 'unknown' every row below is provisional. Splitting the
// two into separate pages would mean reading a backlog on one screen and
// correcting it on another; here, the correction is a button on the row that
// prompted it.
//
// ORDERING
// --------
// Unassessed rows first, and inside that group the ranking's own order (most
// pages improved first). That is the most useful triage available: the top row
// is both the highest-impact photograph on the site AND a single click away
// from becoming either a real task or a struck-out one.
//
// NO PROGRESS BAR
// ---------------
// While nothing has been assessed there is nothing to show progress through. A
// 0% bar would assert that a process is underway and merely early. The header
// says plainly that nobody has looked yet, and the bar appears only once at
// least one product has actually been marked — totals.hasProgress.

export const metadata = { title: "Photography" };

const PRIORITY_TONE: Record<PhotoRequestPriority, "red" | "amber" | "neutral"> = {
  high: "red",
  medium: "amber",
  low: "neutral",
};

const ACCESS_TONE: Record<OwnerAccess, "green" | "blue" | "red" | "neutral"> = {
  owned: "green",
  borrowable: "green",
  retail_display: "blue",
  not_accessible: "red",
  unknown: "neutral",
};

function Row({ item, index }: { item: PhotographyItem; index?: number }) {
  return (
    <li className="flex flex-col gap-3 py-4 lg:flex-row lg:items-start lg:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {index !== undefined && (
            <span className="text-xs tabular-nums text-neutral-400">#{index + 1}</span>
          )}
          <TextLink href={`/admin/products/${item.productId}`}>{item.productName}</TextLink>
          {item.priority && (
            <Badge tone={PRIORITY_TONE[item.priority]}>{item.priority} priority</Badge>
          )}
          <Badge tone={ACCESS_TONE[item.ownerAccess]}>{ACCESS_LABEL[item.ownerAccess]}</Badge>
          {item.productPublished ? (
            <Link
              href={`/products/${item.productSlug}`}
              target="_blank"
              rel="noopener"
              className="text-xs text-neutral-400 underline hover:text-neutral-700"
            >
              view
            </Link>
          ) : (
            <span className="text-xs text-neutral-400">unpublished</span>
          )}
        </div>

        <p className="mt-1 text-xs text-neutral-600">
          <span className="tabular-nums font-medium text-neutral-800">{item.pagesAffected}</span>{" "}
          published {item.pagesAffected === 1 ? "page" : "pages"} would be improved
          {item.articleTitles.length > 0 && (
            <>
              {" "}
              ({item.productPublished ? "its own page plus " : ""}
              {item.articleTitles.length}{" "}
              {item.articleTitles.length === 1 ? "article" : "articles"})
            </>
          )}
          {" · leads with "}
          <span className="font-medium text-neutral-800">
            {CURRENT_MEDIA_LABEL[item.currentMedia]}
          </span>
        </p>

        {item.reason && (
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-neutral-500">{item.reason}</p>
        )}

        {item.articleTitles.length > 0 && (
          <p className="mt-1 max-w-3xl truncate text-xs text-neutral-400">
            Waiting: {item.articleTitles.slice(0, 3).join(" · ")}
            {item.articleTitles.length > 3 && ` · +${item.articleTitles.length - 3} more`}
          </p>
        )}
      </div>

      <div className="lg:w-96 lg:shrink-0">
        <AccessControl
          productId={item.productId}
          productName={item.productName}
          current={item.ownerAccess}
          note={item.ownerAccessNote}
          setAt={item.ownerAccessSetAt}
        />
      </div>
    </li>
  );
}

export default async function PhotographyPage() {
  await requireAdmin();
  const { requests, notRequested, totals } = await getPhotographyOverview();

  const unassessedFirst = requests.filter((r) => r.ownerAccess === "unknown");
  const assessedRequests = requests.filter((r) => r.ownerAccess !== "unknown");

  return (
    <div>
      <PageHeader
        title="Photography"
        description={
          "What to photograph next, ranked by how many published pages each photograph would " +
          "improve — and whether anyone can actually get at the object. The ranking is site " +
          "value; access is a fact about the world that only you can record."
        }
      />

      <div className="flex flex-col gap-6">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-neutral-900">Where the assessment stands</h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Products", totals.products],
              ["Assessed", totals.assessed],
              ["Not assessed", totals.unassessed],
              ["Confirmed reachable", totals.confirmedShootable],
              ["Out of reach", totals.notAccessible],
              ["Photo requests", totals.requests],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-xs text-neutral-500">{label}</dt>
                <dd className="text-2xl font-semibold tabular-nums text-neutral-900">{value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 max-w-3xl text-xs leading-relaxed text-neutral-600">
            {assessmentHeadline(totals)}
          </p>

          {/* Only drawn once something has actually been assessed. An empty bar
              would claim a process is underway when none is. */}
          {totals.hasProgress && (
            <div className="mt-3 max-w-md">
              <div
                role="progressbar"
                aria-valuenow={totals.assessed}
                aria-valuemin={0}
                aria-valuemax={totals.products}
                aria-label="Products assessed"
                className="h-2 w-full overflow-hidden rounded-full bg-neutral-200"
              >
                <div
                  className="h-full rounded-full bg-neutral-900"
                  style={{ width: `${Math.round((totals.assessed / totals.products) * 100)}%` }}
                />
              </div>
            </div>
          )}

          <p className="mt-3 max-w-3xl text-xs leading-relaxed text-neutral-500">
            &ldquo;Not assessed&rdquo; is the default for every product and means nobody has looked.
            It is never treated as &ldquo;cannot be photographed&rdquo; — those rows stay in the
            list, at the top, because answering one is what makes the rest of the list true.
          </p>
        </Card>

        <Card className="p-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-neutral-900">Never assessed</h2>
            <Badge tone="neutral">{unassessedFirst.length}</Badge>
          </div>
          <p className="mb-3 max-w-3xl text-xs leading-relaxed text-neutral-500">
            Ranked by pages improved, highest first. Each of these is one click from becoming a real
            shooting task or being struck off — nothing else on this page is cheaper to resolve.
          </p>
          {unassessedFirst.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Every product with a photo request has been assessed.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-200">
              {unassessedFirst.map((item, i) => (
                <Row key={item.productId} item={item} index={i} />
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-neutral-900">Assessed</h2>
            <Badge tone="neutral">{assessedRequests.length}</Badge>
          </div>
          <p className="mb-3 max-w-3xl text-xs leading-relaxed text-neutral-500">
            Still ranked by pages improved. A row marked &ldquo;Cannot obtain&rdquo; stays here
            rather than disappearing — the site&rsquo;s need for the image is real and does not go
            away; it just will not be fixed by a camera. Those need a licensed photograph or an
            illustration instead.
          </p>
          {assessedRequests.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Nothing assessed yet. Mark a product above and it will move here.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-200">
              {assessedRequests.map((item) => (
                <Row key={item.productId} item={item} />
              ))}
            </ul>
          )}
        </Card>

        {notRequested.length > 0 && (
          <Card className="p-5">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-neutral-900">No photograph requested</h2>
              <Badge tone="green">{notRequested.length}</Badge>
            </div>
            <p className="mb-3 max-w-3xl text-xs leading-relaxed text-neutral-500">
              These already lead with our own photograph, or with a data graphic that a photograph
              would make worse. Listed so the access record can still be completed for the whole
              catalogue, not so anyone shoots them.
            </p>
            <ul className="flex flex-col divide-y divide-neutral-200">
              {notRequested.map((item) => (
                <Row key={item.productId} item={item} />
              ))}
            </ul>
          </Card>
        )}

        {totals.products === 0 && (
          <EmptyState
            title="No products yet"
            description="Add products to the catalogue and the shooting list will build itself from what they need."
          />
        )}

        <Card className="p-5">
          <h2 className="mb-2 text-sm font-semibold text-neutral-900">The shots, every time</h2>
          <p className="mb-3 max-w-3xl text-xs leading-relaxed text-neutral-500">
            Deliberately generic. A per-category shot list would need a taxonomy of body parts per
            product type to be real, and a wrong shot list is worse than a general one — it sends
            you to photograph something no article discusses.
          </p>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-xs text-neutral-600">
            {BASE_SHOT_LIST.map((shot) => (
              <li key={shot}>{shot}</li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
