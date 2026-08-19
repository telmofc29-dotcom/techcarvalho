import { requireAdmin } from "@/lib/dal";
import { isAnalyticsConfiguredServer } from "@/lib/analytics/server-status";
import { PageHeader, Card } from "@/components/admin/ui";

export default async function AdminAnalyticsPage() {
  await requireAdmin();
  const configured = isAnalyticsConfiguredServer();

  return (
    <div>
      <PageHeader title="Analytics" description="Route shell for a future analytics dashboard." />
      <Card className="p-5 max-w-xl">
        <p className="text-sm text-neutral-700">
          GA4 environment variable is{" "}
          <span className={configured ? "text-green-700 font-medium" : "text-neutral-500"}>
            {configured ? "configured" : "not configured"}
          </span>
          .
        </p>
        <p className="text-sm text-neutral-500 mt-2">
          No analytics data is fetched or displayed here — this route exists as a placeholder for a future
          dashboard (e.g. pulling GA4 or internal metrics) so the navigation and access boundary are in place
          ahead of that work.
        </p>
      </Card>
    </div>
  );
}
