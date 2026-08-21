# Analytics Insights & Opportunity Score — methodology

Implementation: `src/lib/analytics/insights-engine.ts`. This document exists so the
opportunity score is never a black box — every number it produces is traceable back
to a real query result via a fixed, documented formula.

## Design principle

Deterministic first. Every insight sentence and every opportunity score component is
computed from a real query against `analytics_events`/`analytics_sessions` (or the
catalogue/content tables), never invented or interpolated from a template with no
underlying number. No external AI/LLM call is used anywhere in this engine — see
"Natural-language layer" below for what that would require if added later.

## Insight statements

Two kinds, never conflated:

- **`observation`** — a directly measured fact ("X grew 34% vs the previous period").
  Always derived from a real trend/count comparison.
- **`recommendation`** — an inference drawn from an observation ("searches are rising
  with little matching content — consider adding coverage"). Always phrased as a
  suggestion, never as a measured fact.

Every insight carries a `confidence` (`high`/`medium`/`low`) based on the **volume**
of the underlying data, not a subjective judgement call:

- `low`: below `MIN_INSIGHT_VOLUME` (5) — in practice these are filtered out before
  ever being generated, so a shown insight is never `low` confidence in the current
  implementation; the level exists for future rules that may want a wider floor.
- `medium`: at or above the volume floor but below each rule's own "high" threshold
  (typically ~15-30, chosen per rule — e.g. a zero-result search needs ≥15
  occurrences to be `high` confidence, since a handful of one-off zero-result queries
  is much weaker evidence of real demand than 15+).
- `high`: comfortably above the volume floor for that specific rule.

**Minimum data thresholds are hard cutoffs, not soft**: below `MIN_INSIGHT_VOLUME`
(5) for the relevant metric, no insight is generated at all for that category/term/
page — not a low-confidence one. On a young, low-traffic site this means most
periods will legitimately produce few or zero insights. That is the correct, honest
output. The thresholds are not tuned down over time just to make the panel look
populated.

## Opportunity score (0-100)

One score per taxonomy category, computed only from categories that exist in the
seeded `taxonomy_categories` table (never a fabricated category).

### Inputs and weights

| Input | Weight | What it measures |
|---|---|---|
| Demand | 0.35 | Relative views + searches this period |
| Growth | 0.25 | Positive trend % vs the previous equivalent period (0 if flat/declining) |
| Engagement | 0.15 | Content clicks per viewing session, within this category |
| Commercial | 0.15 | Affiliate/outbound clicks attributed to this category |
| Supply (inverted) | 0.10 | Published product + content count in this category — **low** supply scores **high**, since low supply relative to real demand is what makes something an opportunity rather than already-served demand |

Weights sum to 1.0 and are the only place "how much each input matters" is decided —
change them here, not per call site.

### Normalisation

Every input except Supply is normalised **relative to the other categories in the
same computation batch** (`value / max(all categories' values) * 100`), not against
an absolute external scale. This is a deliberate choice: an opportunity score
answers "which of *our own* categories looks most promising right now", not a claim
about the broader market. Supply uses the same relative-max normalisation, then the
result is inverted (`100 - normalized`).

### Minimum data threshold

A category with fewer than `MIN_OPPORTUNITY_VOLUME` (5) combined views+searches this
period gets `score: null` and a `reasons: ["Insufficient traffic/search volume..."]`
entry instead of a number — never a misleading 0 (which would look like "definitely
not an opportunity") or a default 50 (which would look like "average, don't know").
The UI must render `null` as "insufficient data", not as a number.

### Treatment of missing data

- A category with **zero** published products/content is not treated as a query
  failure — it's real, honest input (maximally "under-supplied", scoring the full
  10 supply points), since a genuine content gap is exactly the case this score
  exists to surface.
- A category that exists in `taxonomy_categories` but wasn't found in that lookup
  (shouldn't happen, defensive only) gets `score: null` with an explicit reason
  rather than silently defaulting any component to 0.

### Reading the `reasons` field

Each score includes 1+ short, evidence-backed reason strings (e.g. "High relative
demand (312 views, 40 searches)."), generated only when that specific component
crossed a threshold (demand ≥60, growth ≥40, supply ≥70, commercial ≥40) — so a
reader can see *why* a score landed where it did without needing to inspect the raw
`evidence` object, which is also always attached for full transparency.

## "TechCarvalho Today" briefing

A template assembly, not generated prose: the highest-confidence insights (sorted
`high` → `medium`, top 4) are concatenated as their own sentences,
`buildTodayBriefing()` in `insights-engine.ts`. No LLM call. If there are zero
insights for the period, the briefing is `null` and the UI shows nothing rather than
a filler sentence.

## Natural-language layer (not built — documented only, per this batch's directive)

A genuinely polished, more varied natural-language summary (rather than template
concatenation) would require:

- **Provider**: the Anthropic API (Claude) — this codebase has no reason to route
  through a different vendor, and Anthropic's Messages API is a standard, well-
  documented REST call with no special integration needed beyond an API key.
- **Integration point**: a new server-only function alongside `buildTodayBriefing()`
  in `insights-engine.ts`, called from the same place, given the same `Insight[]`
  array as input — the deterministic engine stays the source of truth; the LLM call
  would only be asked to rephrase/summarise pre-computed, already-verified
  observations, never to generate or judge numbers itself.
- **Data sent**: only the already-aggregated `Insight[]` array (category
  names/slugs, rounded percentages, view/search counts, page paths) — never raw
  event rows, never any visitor/session identifier, never anything below the
  aggregation level already shown in the admin dashboard itself.
- **Privacy**: the data above contains no PII by construction (matches this whole
  analytics system's existing no-PII design) — the exposure is business data (which
  content categories/products are trending), not user data, so this is a business-
  confidentiality question, not a privacy-regulation one. Still worth a conscious
  decision before sending it to a third party.
- **Cost**: at TechCarvalho's realistic traffic volume, this would be one short
  request (a small `Insight[]` array in, a paragraph out) per dashboard load or per
  scheduled daily briefing generation — call volume this low is a negligible cost
  even on Claude's smallest current model; the real cost driver would be *how often*
  it's triggered (on-demand per admin page view vs. once daily via a cached/
  pre-generated briefing), not the per-call price. A once-daily cron-generated
  briefing (reusing the existing `analytics_daily_rollups` cron pattern) would keep
  this effectively free at any realistic traffic level.

Not implemented in this batch — the deterministic template above already satisfies
"work without a paid AI API" and produces evidence-backed, non-fabricated text.
