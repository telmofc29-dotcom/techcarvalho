# SILENT_SUCCESS audit — every autonomous pipeline boundary

Date: 2026-08-22. Scope: `src/lib/engine/**`, `src/app/api/engine/**`, every `supabase.rpc(...)` and
`.from(...)` mutation in `src/` and `scripts/`. Excluded by instruction: `src/lib/engine/chaos/`,
`src/lib/media/providers/`.

Method: traced each finding to the lines that produce it. **CONFIRMED** means the code path was read
end to end and genuinely behaves this way. **SUSPECTED** means one link is inferred.

A note that colours several findings below: `supabase/migrations_pending/20260822_silent_success_telemetry.sql`
**is still in `migrations_pending/`**, not `migrations/`. If it has in fact been applied in production,
the repo's own convention (CLAUDE.md: "move it into `migrations/` only once it's actually been run")
has been broken, and — more importantly — several code paths key their behaviour off the belief that
it has *not* been. Those are S4, S8 and S15.

---

## S1 — CRITICAL / CONFIRMED. The shadow stage runs with no circuit breaker, under a job name nothing measures.

**`src/lib/engine/jobs/shadow-job.ts:29`** — `const JOB = "engine_shadow";`
**`src/app/api/engine/tick/route.ts:116`** — `shadow_evaluation: "engine_shadow_evaluation",`

Two separate failures fall out of the mismatch.

*No gate.* `route.ts:175` calls `guard.gateFor("engine_shadow_evaluation")`. In `guard.ts:318` that
calls `capabilityOf(jobName)`, which is `ENGINE_JOBS.find(...)?.capability ?? null`
(`concurrency.ts:233-235`). `ENGINE_JOBS` contains neither `engine_shadow_evaluation` nor
`engine_shadow` — the 14 entries stop at `engine_entity_resolution_log`. So `capability` is `null`,
the entire `if (capability) { ...breakers... }` block at `guard.ts:320-328` is skipped, and the only
remaining check is `budgetGateForJob`, which returns `allow: true` for any unmapped job
(`budgets.ts:250-257`). The stage runs unconditionally. That includes running while the
`database_errors` breaker is open — the one breaker whose `halts` is `ALL_CAPABILITIES`
(`circuit-breaker.ts:547`).

*No measurement.* `recordJobRun` writes `job_name = 'engine_shadow'`. Everything that meters this
stage — `budgets.ts JOB_BUDGET_KEYS`, `health.ts` job-interval and stuck-run checks,
`circuit-breaker.ts` — is keyed by job name, and none of them will ever see a row for
`engine_shadow_evaluation`. The rows accumulate under a name nothing queries.

**What it looks like when it happens:** exactly what it looks like now. Every tick runs shadow
evaluation, every run reports success, the guard detail lists thirteen gated stages and one that
was never asked about.

**Why this one is first:** `route.ts:96-100` documents this precise hazard for the layer above —
"a stage whose job name this map does not know would otherwise silently receive no gate at all — an
unguarded stage that looks exactly like a guarded one" — and `route.ts:164-173` refuses to run such a
stage. The same hole one layer down returns `allow: true` instead. And the stage it exempts is the
one whose output is the readiness evidence.

**Smallest fix:** add an `engine_shadow_evaluation` entry to `ENGINE_JOBS`, change
`shadow-job.ts:29` to `"engine_shadow_evaluation"`, and make `gateFor` return
`{ allow: false }` when `capabilityOf()` is null — mirroring the refusal `route.ts:164` already makes.

---

## S2 — CRITICAL / CONFIRMED. One denied RPC turns the whole engine off, and every detector reports clean.

**`src/lib/engine/cron.ts:208-210`**

```ts
const { data, error } = await supabase.rpc("engine_flag_enabled", { p_flag: flag });
if (error) return false;
```

Fails closed, which is right. What follows is not. Every job's first act is
`if (!(await isFlagEnabled(...))) { recordJobRun(..., "skipped", ..., { reason: "discovery_disabled" }) }`
(`discovery.ts:42-45`, and the same shape in all thirteen others). So a revoked grant, a renamed
function, or a PGRST202 on `engine_flag_enabled` records fourteen `skipped` rows whose stated reason
— "discovery_disabled" — is a fabrication. The flag was never read.

Then the detector goes blind on exactly those rows:

- `silent-success.ts:235` — `const measured = runs.filter((r) => r.status !== "skipped");` → empty.
- `silent-success.ts:239` — `if (!anyCounters && measured.length > 0)` → false at zero, so not even
  the `detection_unavailable` warning fires.
- `finish(signals, telemetry)` returns `clean: true`, `summary: "No SILENT_SUCCESS signals."`
- `circuit-breaker.ts:790-806` — `criticalSignals: 0`, `postconditionTelemetry: "absent"` →
  `state: "closed"`, `halts: []`.
- `route.ts:200-205` → `status: "success"`, `ok: true`.

**What it looks like when it happens:** an engine that has done nothing for weeks, with a green tick
every hour, a clean silent-success report, all breakers closed, and fourteen job rows a day each
claiming a feature flag is off.

**Smallest fix:** two lines. Make `isFlagEnabled` return `true | false | "unreadable"` so a read
failure records `failed` rather than `skipped`; and in `detectSilentSuccess`, raise
`detection_unavailable` when `measured.length === 0 && runs.length > 0` — "every run was skipped" is
a fact the detector currently cannot express.

---

## S3 — CRITICAL / CONFIRMED. The tick reports success when every stage skipped, and when every stage was partial.

**`src/app/api/engine/tick/route.ts:182-205`**

```ts
const result = await run(supabase);
anyRan = true;                                   // <- 184, before result.status is read
stages[name] = result;
if (result.status === "failed") anyFailed = true;
if (result.status === "skipped") anySkipped = true;
...
const status =
  anyFailed && !anyRan ? "failed"
  : anyFailed ? "partial"
  : anyHalted ? "partial"
  : anyRan ? "success"
  : "failed";
```

`anyRan` is set unconditionally at line 184, before `result.status` is inspected. A stage that
returned `skipped` still sets it. `anySkipped` is computed at line 187 and appears only in the
`detail` payload at line 211 — it is absent from the status expression entirely. And `partial` is
never tracked at all: `anyFailed` tests only for `"failed"`.

So both of these produce `status: "success"`:

- all 14 stages return `skipped` (the S2 scenario);
- all 14 stages return `partial` — which is precisely what `statusFromPostconditions` returns when a
  pass had silent no-ops but also some verified writes (`postconditions.ts:717-725`).

The comment at `route.ts:196-199` states "A pass in which every stage was halted or skipped is NOT a
success" and calls the alternative "the tick's own version of the failure class this whole layer
exists to catch". The halted half is implemented. The skipped half is not, and partial was never
considered.

**Smallest fix:** `anyRan = result.status !== "skipped";` and add an `anyPartial` branch above
`anyHalted`.

---

## S4 — CRITICAL / CONFIRMED. The `pendingRpc` amnesty never expires, and it suppresses the cross-run backstop.

**`src/lib/engine/postconditions.ts:432-475`** (and `:477-507` for `pendingCreatedId`)

```ts
if (result.status === "unverifiable") {
  const blindResult: PostconditionResult<string> = { ...result, status: "blind", ok: true };
  tally(blindResult as PostconditionResult, false);
  return blindResult;
}
```

`spec.migration` is an inert string used only in the message text. Nothing checks whether the named
migration has been applied, so the amnesty has no end date. Post-migration, a `null` return can no
longer mean "the deployed function still returns void" — it means something is wrong — and it is
still laundered into `blind`, which `tally` counts as neither created nor failed
(`postconditions.ts:376-378`).

That would be tolerable if it stayed a warning. It does not. **`silent-success.ts:370`**:

```ts
const explainedByBlindness = ordered.some((r) => (r.blindWrites ?? 0) > 0);
if (created === 0 && examined > 0 && !everFailed && !explainedByBlindness) { ... never_effective ... }
```

Any blind write in the window suppresses the CRITICAL `never_effective` signal — the cross-run
backstop written specifically to catch incident #2 — and replaces it with the WARNING
`unprovable_by_construction`. A job whose write RPC has started returning null therefore gets
*quieter*, permanently.

Live call sites in the amnesty: `discovery.ts:90, 112, 173` (`engine_record_source_check`),
`opportunity-job.ts:78` (`engine_upsert_opportunity`), `draft-job.ts:105` and `product-job.ts:110`
(`engine_record_entity_resolution`).

**Secondary defect, same file:** `mutateBlind` sets `ok: false` on a blind result
(`postconditions.ts:230-232`) with the comment *"NOT ok. A blind write is an admission, not a pass"*.
`pendingRpc` sets `ok: true` on the identical status (`:469`, `:501`). One field, two opposite
meanings. `freshness-job.ts:158` and `draft-job.ts:164` both branch on `.ok` to decide whether a
proposal exists.

**Smallest fix:** one exported constant — `export const SILENT_SUCCESS_TELEMETRY_APPLIED = true;` —
read by `pendingRpc`/`pendingCreatedId`; when set, a null answer stays `unverifiable` (i.e. failed).
Separately, set `ok: false` in both blind paths.

---

## S5 — CRITICAL / CONFIRMED. Unreadable escape counts become zero escapes, on the path that unlocks autonomy.

**`scripts/run-shadow-evaluation.ts:374-388`**

```ts
const escapesProbe = await client.rpc("engine_shadow_escapes");
const escapeRow = (escapesProbe.data ?? [])[0] as | {...} | undefined;

const readiness = assessShadowReadiness({
  ledger,
  escapes: {
    wouldPublish: escapeRow?.would_publish ?? 0,
    fabricatedClaimEscapes: escapeRow?.fabricated_claim_escapes ?? 0,
    unlicensedMediaEscapes: escapeRow?.unlicensed_media_escapes ?? 0,
    bypassedHardBlockers: escapeRow?.bypassed_hard_blockers ?? 0,
    ...
```

`escapesProbe.error` is never inspected. A denied or missing `engine_shadow_escapes` gives
`data: null` → `escapeRow: undefined` → seven `?? 0` defaults. Zero fabricated-claim escapes, zero
unlicensed-media escapes, zero bypassed hard blockers is the **best possible evidence**, and it feeds
`evaluateReadiness` directly (`shadow-readiness.ts:138-140, 147`).

`ShadowReadinessInput` has no `escapesAvailable` field at all (`shadow-readiness.ts:66-80`); only the
ledger gets an availability flag, and only the ledger produces a blocker (`:150-156`) and clamps the
mode (`:161`, `:168`). So this failure fails **open**, toward AUTONOMOUS.

Three things make it worse:

1. Three lines earlier, the same function does the opposite for the same class of gap:
   `humanDisagreementRate` returns `1` — total disagreement — when `humanReviewed === 0`
   (`:123-126`), with the comment "An unmeasured rate is not a passing rate."
2. `src/app/admin/(dashboard)/engine/autonomy/page.tsx:91` folds `escapesResult.error` into
   `ledgerError`, so the admin page and the script give different verdicts on exactly this case.
3. `supabase/migrations_pending/20260823_engine_rpc_anon_surface.sql:61` **revokes**
   `engine_shadow_escapes` from `anon`. This failure is scheduled, not hypothetical.

**Smallest fix:** add `escapesAvailable: boolean` to `ShadowReadinessInput`, block on it exactly as
`ledgerAvailable` does, and pass `!escapesProbe.error` from the script.

---

## S6 — CRITICAL / CONFIRMED. Post-migration, `engine_record_entity_resolution` will inflate `items_created` — the exact counter the detectors key on.

`draft-job.ts:105` and `product-job.ts:110` call `log.pendingCreatedId` for
`engine_record_entity_resolution`. Post-migration that RPC returns a **uuid**. `pendingCreatedId`
tallies a uuid as a creation:

**`postconditions.ts:505`** — `tally(result as PostconditionResult, isRowId(result.data));`
**`postconditions.ts:363-366`** — `case "verified": if (createdWhen) counters.created++;`

Both jobs log a resolution row for *every* candidate they look at, including the ones they then
decline (`product-job.ts:110` runs before the `matched_existing` / `ambiguous` / `ignored` branches at
`:130-145`; `draft-job.ts:105` runs before every branch). So `items_created` for
`engine_product_assembly` and `engine_draft_assembly` stops meaning "products/articles assembled" and
starts meaning "audit rows written".

Everything downstream reads that column:

- `budgets.ts:155` — `ledger[key] += run.itemsCreated`, keys `new_products` / `new_articles`.
- `health.ts:544-546` — `createdLast24h` sums `itemsCreated`, feeding the `publication_volume`
  breaker and its hard ceiling of 25/day (`circuit-breaker.ts:127`).
- `silent-success.ts:272` — `touched = created + deduped + failed`; rule 1 goes quiet.
- `silent-success.ts:363, 371` — `created === 0` is the `never_effective` trigger; it can never be
  zero again.

**What it looks like when it happens:** `engine_product_assembly` reports `examined: 30, created: 30`
while assembling zero products. The volume breaker halts creation on the strength of writes that
created nothing. Both cross-run detectors are satisfied.

**Smallest fix:** the entity-resolution call is an audit-log append, not a creation. Use
`log.blind({ operation, why })` for it, or add a `countsAsCreation: false` option to
`pendingCreatedId`.

---

## S7 — HIGH / CONFIRMED. `stage-outcome.ts` has no production callers. 1,273 lines of dead classifier.

`classifyStageOutcome`, `incidentFor`, `incidentsFor`, `hasBlockingIncident`, `incidentAsFinding`,
`detectUniformity` and `fromSearchOutcomeState` are imported by exactly one file:
`src/lib/engine/stage-outcome.test.ts`. No job, no tick, no guard, no health module calls any of
them. `hardenReadiness` (`silent-success.ts:655`) is in the same position — test-only, so the
SILENT_SUCCESS graduation blockers never reach `modes.ts` or `shadow-readiness.ts`.

The consequence is not abstract. The module's central rule — NOTHING_TO_DO is reachable only through
a positive `InputProbe` with an `EmptinessProof` stronger than `zero_rows_only` (`:886-951`) — is
implemented nowhere, because no job constructs an `InputProbe`. Four jobs today return `"success"`
on a read that returned `[]`, with no way to tell a denied read from an empty queue:

| Site | Shape |
|---|---|
| `link-job.ts:74-77` | `published.length === 0` → `recordJobRun(..., "success", ..., { reason: "no_published_content" })` |
| `product-job.ts:84-87` | `manufacturers.length === 0` → `"success"`, `no_manufacturer_records` |
| `draft-job.ts:66-69` | `briefs.length === 0` → `"success"`, `no_approved_briefs` |
| `hero-media-job.ts:101` | `entities` empty → loop body never runs → all counters 0 |

None is catchable by `silent-success.ts` either: rule 1 requires `examined > 0`, and all four jobs
are declared `role: "assessor"` in `STAGE_EFFECTS` (`silent-success.ts:139-142`), which switches off
`never_effective` by design. Their failure mode has no detector.

`hero-media-job.ts` closes the loop on itself: with zero entities the postcondition log is empty, and
`statusFromPostconditions` returns `"success"` for `summary.total === 0` (`postconditions.ts:716`).

**Smallest fix:** call `classifyStageOutcome` once at each job's tail with the counters it already
has, and write `verdict.outcome` + `verdict.ambiguity` into the `detail` payload. Even with no
`InputProbe` supplied, the four jobs above land on `UNCLASSIFIED / emptiness_unproven`
(`:901-909`) instead of `success`.

---

## S8 — HIGH / CONFIRMED. A refused audit row is logged to the console and then discarded.

**`src/lib/engine/cron.ts:117-201`**

`recordJobRun` returns `Promise<void>`. Line 188 does inspect the answer:

```ts
if (data !== null && data !== RECORDED) {
  logQueryError(`engine_record_job_run(${jobName}) answered '${String(data)}' — it REFUSED the audit row ...`);
}
```

`logQueryError` is `console.error` and nothing else (`src/lib/log/query-error.ts:10-13`). The job
returns `status: "success"` to the tick regardless, and the tick reports `ok: true`. The run is
absent from `engine_job_runs`, so `health.ts`, every breaker, and `detectSilentSuccess` never see it —
and `silent-success.ts`'s own detectors are all *presence*-based, so a missing row is invisible by
construction.

This compounds S1: `'rejected_invalid_job_name'` is a real return value of the migrated RPC, and
`engine_shadow` is the job name most likely to hit a guard list built from `STAGE_JOB_NAMES`.

Line 188 also carries the same never-expiring amnesty as S4 — `data !== null` treats a null answer as
the tolerated pre-migration shape.

**Smallest fix:** `recordJobRun` returns the status string; the tick folds "audit row refused" into
its own status.

---

## S9 — HIGH / CONFIRMED. `media-acquisition-job.ts` fabricates an empty duplicate-check set.

**`src/lib/engine/jobs/media-acquisition-job.ts:197-200`**

```ts
const { data: existingAssets } = await supabase.from("media_assets").select("source_url");
const existingSourceUrls = new Set(
  (existingAssets ?? []).map((a) => a.source_url).filter((u): u is string => Boolean(u))
);
```

The `error` is not destructured at all. This read runs as `anon`; on a denial it returns `[]` with no
error. `existingSourceUrls` becomes empty, and it is handed straight to
`runAcquisitionPipeline`'s ranking context (`:327`), where the duplication criterion then answers
"not a duplicate" for every candidate. No counter, no log line, no status change.

The comment three lines above claims the opposite: *"so the ranking's duplication criterion is a real
check rather than a nominal one"*. And the file fixed this exact bug 25 lines earlier for
`engine_sources` — `sourceRegistryAvailable` at `:174`, with the whole rationale written out at
`:163-170` — and then omitted it for the next query.

This is the media-pipeline ↔ engine boundary the audit was asked to check: the pipeline receives a
fabricated-empty exclusion set and returns a confident ranking built on it. Note that
`existingContentHashes` two lines below is documented as unchecked (`:321-326`) — so if this read is
denied, **both** duplication inputs are empty and the criterion is entirely inert while reporting a
score.

**Smallest fix:** destructure the error and pass an explicit availability flag into the ranking
context, exactly as `sourceRegistryAvailable` does for the manufacturer branch.

---

## S10 — MEDIUM / CONFIRMED. `loadTelemetry` collapses "denied" and "no rows" into one `undefined`, and two breakers fail open on it.

**`src/lib/engine/guard.ts:137-153`, `:155-175`**

On `sourceResult.error` or `validationResult.error`, a string is pushed to `unavailableReasons` and
the corresponding input is left `undefined`. `telemetry.available` (line 107) tracks only the runs
RPC, so it stays `true`.

`evaluateBreakers` then gets `sources: undefined` → `noData("source_failures", ...)` →
`FAIL_CLOSED.source_failures === false` (`circuit-breaker.ts:112`) → `state: "closed"`, `halts: []`.
Same for `validation_rejection_spike` (`:114`).

The fail-closed table's own justification is only valid for one of the two cases it cannot
distinguish — `circuit-breaker.ts:100-101`: *"no source telemetry means no source was polled, which
creates nothing. Absence here is genuinely benign."* True when the RPC returned no rows. False when
the RPC was denied. The code has no way to tell.

`unavailableReasons` reaches only `guard.detail()` (`:339`), a jsonb blob in the tick's detail
payload. It never affects any status.

**Smallest fix:** make the two fields tri-state — `SourceFailureInput | "unavailable" | undefined` —
and have `noData` open when the value is `"unavailable"` regardless of the `FAIL_CLOSED` entry.

---

## S11 — MEDIUM / CONFIRMED. `deleteRow` turns an RLS-denied delete into a clean success, across eight admin paths.

**`src/lib/admin/reference-service.ts:103`**

```ts
const { error } = await supabase.from(table).delete().eq("id", id);
if (error) throw new Error(error.message);
```

No `.select()`, no `{ count: 'exact' }`. This is incident #1's literal shape, in the shared helper.
Callers, all of which `revalidatePath` and report success afterwards: `products/actions.ts:102`,
`content/actions.ts:150`, `media/actions.ts:403`, `taxonomy-tags/actions.ts:56`,
`taxonomy-categories/actions.ts:79`, `spec-definitions/actions.ts:76`, `manufacturers/actions.ts:71`,
`product-families/actions.ts:69`.

`media/actions.ts:403` is the sharp one: it deletes the storage objects at `:407` and `:409`
regardless of whether the row delete affected anything, so a denied delete still destroys the files.

The correct pattern is already in the same file — `updateRow` at `:85` uses `.select("*").single()`,
which returns `PGRST116` on zero rows and therefore throws on a denial.

**Smallest fix:** add `.select("id")` to `deleteRow` and throw when the returned array is empty. One
edit closes all eight.

---

## S12 — MEDIUM / CONFIRMED. `engine/actions.ts` discards `error` on all ten mutations.

`src/app/admin/(dashboard)/engine/actions.ts` lines **61, 114, 163, 195, 211, 240, 292, 333, 388,
421, 436, 491**. None destructures `error`; all `revalidatePath` immediately. `:491` carries an
explicit acknowledgement in its docblock that "this action shape swallows the error".

Two are worse than the generic pattern:

- **`:61` `updateEngineSettings`** — the engine kill-switch panel. A denied write means the toggles
  visually flip on the next render and the engine keeps running.
- **`:333` `overrideDiscoveryRelevance`** — writes `relevance_overridden_by_admin: true`, which is
  the flag `engine_set_relevance` reads to refuse overwriting a human decision. A silent no-op means
  the human ruling never lands, the next relevance pass overwrites it, and that pass correctly
  reports `'updated'`. Two green surfaces, one erased editorial decision.

**Smallest fix:** same as S11 — `.select("id")` and throw on empty.

---

## S13 — MEDIUM / CONFIRMED. Publish/unpublish does the irreversible storage move first, then an unverified row update.

`src/app/admin/(dashboard)/media/actions.ts` **:235, :267, :347, :376**. Each checks `error` and not
the row count; each runs *after* the storage copy or removal has already happened
(`:228`, `:265`, `:339`, `:373`).

- `:347` returns `{ error: null }` — the UI's success signal — after a denied update. The object is
  in `media-public` while the row still says `private`.
- `:235` does `summary.succeeded++` in the same situation.
- `:376` leaves a row claiming `published` with a `public_storage_path` pointing at a deleted object.

`:287` (`bulkUpdateRightsStatus`) is the one site in the codebase that uses `{ count: "exact" }` —
but `return { succeeded: count ?? ids.length, ... }` substitutes the full requested count when
`count` comes back null, and a partial denial (`0 < count < ids.length`) is reported as plain success
with an empty `skipped` array.

---

## S14 — MEDIUM / CONFIRMED. The shadow *script* records decisions with no accepted/benign discipline.

**`scripts/run-shadow-evaluation.ts:278-280`**

```ts
const { data, error } = await client.rpc("engine_shadow_record_decision", serialiseDecision(record));
const key = error ? `error: ${error.code ?? error.message}` : String(data);
persistResults[key] = (persistResults[key] ?? 0) + 1;
```

Every answer is a histogram bucket. `'rejected_disabled'` — the kill switch refusing the write — is
counted identically to `'created'`, and the summary at `:424` prints the histogram without any of
them being a failure.

The engine job performing the same write does it correctly: `shadow-job.ts:151-159` uses `log.rpc`
with `accepted: ["created"], benign: ["deduped", "rejected_disabled"]`. So the instrumented and
uninstrumented versions of one write coexist, and the uninstrumented one is the path a human runs by
hand to generate readiness evidence.

---

## S15 — LOW-MEDIUM / CONFIRMED. `rejected` is unrepresentable in persisted telemetry, so declines are filed as duplicates.

`stage-outcome.ts:226-244` makes the case at length: `engine_job_runs` has four counters with nowhere
to put a deliberate decline, *"which is why six call sites folded 'rejected_invalid' into `deduped`
(incident #2) and why 23 declines incremented nothing at all (incident #4). A taxonomy that cannot
NAME a rejection guarantees that rejections get filed as something benign."*

The fix for incident #4 chose that counter. `update-job.ts:93-94` and `:101-102` do
`notAnUpdate++; counters.deduped++`. `product-job.ts:100-101, 131, 138, 143` does the same for "not a
product announcement", "ignored", "no known category".

The result is honest about *quantity* and wrong about *kind*: `WORK_REJECTED` and
`WORK_DEDUPLICATED` become indistinguishable in the only telemetry anything reads, and
`silent-success.ts:272`'s `touched = created + deduped + failed` is satisfied by declines alone.

**Smallest fix:** add `items_rejected` to `engine_job_runs`, `engine_record_job_run` and
`engine_recent_job_runs`. `stage-outcome.ts` already assumes this counter exists.

---

## S16 — LOW / CONFIRMED. `worstStatus` lets `skipped` override any postcondition finding.

**`postconditions.ts:740`** — `if (jobStatus === "skipped") return "skipped";` — checked *before* the
rank comparison, so a job that ran mutations, observed silent no-ops, and then declared itself
skipped records `skipped`. `silent-success.ts:235` then filters that row out of detection entirely.

No job does this today — every `skipped` return is an early exit before any mutation — so this is a
latent trap rather than a live bug. It is worth naming because S2 depends entirely on `skipped` being
invisible to the detector, and this is the second door into that blind spot.

---

## S17 — LOW / CONFIRMED. The verification script's own probe can pass without exercising the guard.

**`scripts/verify-silent-success-migration.ts:140`** — `setFlag(true)` checks `error` only. A
silently-denied update means the subsequent `'human_override'` assertion runs against an un-flagged
row, and the probe reports **PASS** for a guard that was never exercised. Same gap on the restore at
`:169`.

This is the "verification helper treating no evidence as proof" shape, inside the file written to
verify this failure class. Two sites in the same file get it right — `:348`/`:357` re-reads after the
cleanup delete, with the comment *"deleting is exactly the operation that silently affects zero rows
under RLS, which is incident #1"* — so the pattern was known and just not applied to the probe setup.

---

## Checked and found sound

Recorded so the next audit does not re-derive them.

- **Every `log.rpc` accepted/benign list is correct against the migrated return sets.** The RPC sweep
  confirmed all sixteen. `engine_upsert_opportunity`'s three rejections
  (`no_rows_affected`, `rejected_invalid_subject_type`, `rejected_invalid_subject_key`) all fail
  loudly under `accepted: ["ok"], benign: []`; `engine_record_source_check`'s `no_matching_source`
  fails under `accepted: ["ok"]`; `engine_set_relevance`'s `no_matching_row` fails under
  `accepted: ["ok","updated"], benign: ["human_override"]`. No caller lists a rejection as benign.
  Two cosmetic notes: `opportunity-job.ts:92-93`'s comment reads as though the rejections are
  tolerated when `benign: []` means the opposite; `relevance-job.ts:71` keeps `"ok"` in `accepted`
  where it is now unreachable.
- **`engine_begin_run`** (`guard.ts:203-234`) inspects the answer exhaustively and treats an
  unrecognised value as no lease. This is the model the rest of the codebase should copy.
- **`search-job.ts:39-53`** refuses a non-integer answer from `engine_aggregate_searches` rather than
  coercing it to zero — the right call, and rare.
- **`trend-job.ts:173-188`** treats a `null` from a table-returning RPC as a distinct failure from an
  empty row set, with the reasoning written down.
- **`brief-job.ts:87`, `update-job.ts:115`, `product-job.ts:169`** all fail on
  `error || data === null` for `engine_evidence_for`, rather than `?? []`.
- **`guard.ts:110-118`** treats a `null` from `engine_recent_job_runs` as unavailable, not as an
  empty history.
- **`updateRow`** (`reference-service.ts:85`) and **`media/actions.ts:287`** are the only two
  mutation sites in `src/` that can observe a zero-row denial.

---

## Ranked summary

| # | Severity | Confidence | One line |
|---|---|---|---|
| S1 | critical | confirmed | Shadow stage is ungated and logs under a job name nothing measures |
| S2 | critical | confirmed | A denied flag RPC stops the engine and every detector reports clean |
| S3 | critical | confirmed | Tick reports success when all stages skipped, or all partial |
| S4 | critical | confirmed | `pendingRpc` amnesty never expires and suppresses `never_effective` |
| S5 | critical | confirmed | Unreadable escape counts become zero escapes on the autonomy path |
| S6 | critical | confirmed | Post-migration audit rows inflate `items_created`, blinding two detectors |
| S7 | high | confirmed | `stage-outcome.ts` and `hardenReadiness` have no production callers |
| S8 | high | confirmed | A refused audit row is logged and discarded |
| S9 | high | confirmed | Media job fabricates an empty duplicate-check set from an unchecked read |
| S10 | medium | confirmed | `loadTelemetry` collapses denied and empty; two breakers fail open |
| S11 | medium | confirmed | `deleteRow` reports a denied delete as success, eight call sites |
| S12 | medium | confirmed | `engine/actions.ts` discards `error` on all ten mutations |
| S13 | medium | confirmed | Publish/unpublish moves storage first, then an unverified row update |
| S14 | medium | confirmed | Shadow script records decisions with no accepted/benign discipline |
| S15 | low-med | confirmed | `rejected` unrepresentable in telemetry; declines filed as duplicates |
| S16 | low | confirmed | `skipped` overrides postcondition findings and hides the run from detection |
| S17 | low | confirmed | Verify script's probe can PASS without exercising the guard |

The shape common to S1, S2, S3, S7, S8 and S10: **the safety layer is thorough about what it
measures and silent about whether it measured.** Every one of them is an availability failure in an
observer being rendered as a clean reading from that observer. `stage-outcome.ts` already names this
(`UNCLASSIFIED`, `emptiness_unproven`, `detection_unavailable`) — it just is not wired to anything.
