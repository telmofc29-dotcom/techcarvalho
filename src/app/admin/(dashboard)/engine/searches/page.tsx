import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader,
  Card,
  Badge,
  EmptyState,
  QueryErrorBanner,
  Table,
  Th,
  Td,
} from "@/components/admin/ui";
import { EngineTabs, formatDateTime } from "../shared";

// Internal search intelligence: what visitors ask TechCarvalho for, and
// whether we had an answer.
//
// Zero-result searches are the single highest-value content signal the site
// can produce — a literal, unambiguous record of someone wanting something
// that does not exist yet. They sort to the top for exactly that reason.

const FILTERS = ["unmet", "popular", "recent"] as const;
type Filter = (typeof FILTERS)[number];

type SearchRow = {
  id: string;
  display_query: string;
  search_count: number;
  zero_result_count: number;
  click_count: number;
  first_seen_at: string;
  last_seen_at: string;
};

export default async function EngineSearchesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  await requireAdmin();
  const { view } = await searchParams;
  const activeView: Filter = FILTERS.find((f) => f === view) ?? "unmet";

  const supabase = await createClient();

  let query = supabase
    .from("search_intelligence")
    .select("id, display_query, search_count, zero_result_count, click_count, first_seen_at, last_seen_at")
    .limit(300);

  if (activeView === "unmet") {
    query = query
      .order("zero_result_count", { ascending: false })
      .order("search_count", { ascending: false });
  } else if (activeView === "popular") {
    query = query.order("search_count", { ascending: false });
  } else {
    query = query.order("last_seen_at", { ascending: false });
  }

  const { data, error } = await query;
  const rows = (data ?? []) as SearchRow[];

  const totalSearches = rows.reduce((sum, r) => sum + r.search_count, 0);
  const totalZero = rows.reduce((sum, r) => sum + r.zero_result_count, 0);
  const unmetQueries = rows.filter((r) => r.zero_result_count > 0).length;

  return (
    <div>
      <PageHeader
        title="Search intelligence"
        description="What visitors searched for on TechCarvalho, and whether the site had an answer."
      />
      <EngineTabs current="/admin/engine/searches" />

      <Card className="p-4 mb-6 border-blue-200 bg-blue-50">
        <p className="text-sm font-medium text-neutral-900">Aggregate only — no visitor identifiers</p>
        <p className="text-xs text-neutral-700 mt-1">
          These rows are grouped by query text alone. No visitor id, session id, or IP address is carried into this
          table, so it cannot be joined back to a person. It records what was searched, how often, whether it returned
          nothing, and whether anyone clicked — enough to find unmet demand and nothing more.
        </p>
      </Card>

      {error && <QueryErrorBanner message={`Failed to load search intelligence: ${error.message}`} />}

      {!error && rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3 mb-4">
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Distinct queries</p>
            <p className="text-lg font-semibold text-neutral-900 mt-1 tabular-nums">{rows.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Total searches</p>
            <p className="text-lg font-semibold text-neutral-900 mt-1 tabular-nums">{totalSearches}</p>
          </Card>
          <Card className={`p-4 ${unmetQueries > 0 ? "border-amber-300 bg-amber-50" : ""}`}>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Queries with no results</p>
            <p className="text-lg font-semibold text-neutral-900 mt-1 tabular-nums">
              {unmetQueries}
              <span className="text-xs font-normal text-neutral-500"> ({totalZero} searches)</span>
            </p>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <a
            key={f}
            href={`/admin/engine/searches?view=${f}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              activeView === f ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
            }`}
          >
            {f === "unmet" ? "Unmet demand first" : f === "popular" ? "Most searched" : "Most recent"}
          </a>
        ))}
      </div>

      {!error && rows.length === 0 ? (
        <EmptyState
          title="No search data yet"
          description="On-site searches are aggregated here once the engine's search-intelligence stage runs. It needs consented analytics events to aggregate from."
        />
      ) : (
        !error && (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Query</Th>
                  <Th>Searches</Th>
                  <Th>No results</Th>
                  <Th>Clicks</Th>
                  <Th>Signal</Th>
                  <Th>First seen</Th>
                  <Th>Last seen</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const allZero = r.zero_result_count > 0 && r.zero_result_count >= r.search_count;
                  const someZero = r.zero_result_count > 0 && !allZero;
                  // Searched, returned results, but nobody clicked — the
                  // results existed and were not good enough.
                  const noClicks = r.zero_result_count === 0 && r.click_count === 0 && r.search_count > 1;
                  return (
                    <tr key={r.id}>
                      <Td className="font-medium text-neutral-900">{r.display_query}</Td>
                      <Td className="tabular-nums">{r.search_count}</Td>
                      <Td className={`tabular-nums ${r.zero_result_count > 0 ? "text-amber-800 font-medium" : ""}`}>
                        {r.zero_result_count}
                      </Td>
                      <Td className="tabular-nums">{r.click_count}</Td>
                      <Td>
                        {allZero ? (
                          <Badge tone="red">Content gap</Badge>
                        ) : someZero ? (
                          <Badge tone="amber">Partly unmet</Badge>
                        ) : noClicks ? (
                          <Badge tone="amber">Results ignored</Badge>
                        ) : (
                          <Badge tone="green">Satisfied</Badge>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-neutral-600">{formatDateTime(r.first_seen_at)}</Td>
                      <Td className="whitespace-nowrap text-neutral-600">{formatDateTime(r.last_seen_at)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )
      )}
    </div>
  );
}
