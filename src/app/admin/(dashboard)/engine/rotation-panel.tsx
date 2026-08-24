import { Card } from "@/components/admin/ui";
import { Badge } from "@/components/shared/ui";
import { getSpotlight } from "@/lib/public/spotlight-read";
import { SPOTLIGHT_WINDOW_DAYS } from "@/lib/public/spotlight";

// TODAY'S SPOTLIGHT, on the owner dashboard.
//
// INFORMATIVE, NOT ACTIONABLE — deliberately. The owner asked that rotation
// happen automatically and explicitly asked that this not become another daily
// admin task, so there is no approve button here and there should never be one.
// It exists so that "why is that on the front page?" has an answer without
// anyone opening a database.
//
// The one thing it must be loud about is when rotation is NOT running, because
// the failure is silent by nature: a homepage ordered purely by score looks
// completely normal, it just never changes.

export async function RotationPanel() {
  const spotlight = await getSpotlight(4);
  const lead = spotlight.entries.find((e) => e.role === "lead") ?? null;
  const supporting = spotlight.entries.filter((e) => e.role === "supporting");

  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Homepage spotlight
        </h2>
        <Badge tone={spotlight.source === "rotation" ? "green" : "amber"}>
          {spotlight.source === "rotation" ? "Rotating daily" : "Not rotating"}
        </Badge>
      </div>

      <Card className="p-5">
        {spotlight.note && (
          <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm text-amber-800">{spotlight.note}</p>
          </div>
        )}

        {spotlight.entries.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Nothing is currently eligible for the spotlight.
          </p>
        ) : (
          <>
            {lead && (
              <div className="mb-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-1">
                  Lead
                </p>
                <p className="text-sm font-medium text-neutral-900">{lead.title}</p>
                <p className="text-xs text-neutral-500">
                  {lead.categorySlug ?? "uncategorised"} · published{" "}
                  {lead.publishedAt.slice(0, 10)}
                </p>
              </div>
            )}

            {supporting.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-1">
                  Supporting
                </p>
                <ul className="space-y-1">
                  {supporting.map((e) => (
                    <li key={e.contentId} className="text-sm text-neutral-700">
                      {e.title}
                      <span className="ml-2 text-xs text-neutral-400">
                        {e.categorySlug ?? "uncategorised"} · {e.publishedAt.slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <p className="mt-4 text-xs text-neutral-500 max-w-prose">
          The spotlight holds content published in the last {SPOTLIGHT_WINDOW_DAYS} days and rotates
          automatically overnight — it needs no daily action from you. Older content stays available
          in search, categories, related links and guides; it simply does not occupy the front page.
        </p>
      </Card>
    </div>
  );
}
