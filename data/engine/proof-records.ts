// Recorded executions of the autonomy failure proofs.
//
// WHY THIS IS A FILE IN THE REPOSITORY AND NOT A DATABASE TABLE
// -------------------------------------------------------------
// A proof is a claim that the system was deliberately broken and behaved
// correctly. If that claim lived in a table, the admin UI could write it, and
// "AUTONOMOUS MODE: LOCKED" would become a value somebody could edit. Here,
// changing a proof requires a commit — reviewable, attributable, reversible,
// and unreachable from any browser request.
//
// It is a TypeScript module rather than JSON so the shape is type-checked: a
// malformed record fails the build instead of being silently discarded.
//
// Each record must state what was actually DONE and what was actually
// OBSERVED. src/lib/engine/proofs.ts rejects records with no method or
// observation, records that FAILED, records below the level their kind
// requires, and records older than 30 days — because a proof about code from
// 200 commits ago is not a proof about this code.
//
// DO NOT add a record for something that was not run.

import type { ProofRecord } from "@/lib/engine/proofs";

export const PROOF_RECORDS: ProofRecord[] = [
  {
    kind: "concurrency_test",
    level: "production_proven",
    observedAt: "2026-08-22T00:00:00.000Z",
    commit: "b03e2a4",
    method:
      "Called engine_begin_run twice against the PRODUCTION database with the same job name and the same idempotency key, back to back, as anon — the exact shape of a double scheduler invocation. Then called engine_complete_run on the acquired lease and removed the probe rows.",
    observed:
      "The first call returned 'acquired:625625e8-7e27-4e6a-a488-92dfed247178'. The second returned 'already_running' rather than a second lease, so a duplicate invocation cannot execute the same pass twice. engine_complete_run then returned 'completed', and returned 'not_running' for a lease that was never acquired.",
    passed: true,
  },
  {
    kind: "duplicate_scheduler_test",
    level: "production_proven",
    observedAt: "2026-08-22T00:00:00.000Z",
    commit: "4b4bf86",
    method:
      "Ran scripts/verify-anon-surface-migration.ts against the PRODUCTION database as anon, using the publishable key only. It rebuilds the idempotency key with the same bucket arithmetic as idempotencyKeyFor() (5-minute buckets), acquires the lease for the current window, completes it, then immediately re-attempts the same window — the exact shape of two schedulers firing into one window. It also attempted the previously-successful shutdown attack: leasing a window in 2027, leasing one in 2020, a malformed key, and a key naming a different job than the one being started. Probe rows used the job name 'engine_security_probe', never 'engine_tick', and were deleted afterwards with the remaining count re-checked as 0.",
    observed:
      "Current window: 'acquired:119f4c52-46d8-4b43-953a-21129d07cf45', then 'completed', then 'already_running' for the second worker — so a duplicate scheduler cannot run the same window twice, and the guarantee survived the security migration. All four attack shapes were refused: the 2027 and 2020 windows both returned 'rejected_window' (before 20260823_engine_rpc_anon_surface.sql the 2027 case returned a real lease, which could then be frozen as 'success' and never reaped, silently disabling the engine forever), and the malformed key and the mismatched job name both returned 'rejected_invalid'. 19/19 checks passed, cleanup verified 0 leftover rows.",
    passed: true,
  },
  {
    kind: "rollback_test",
    level: "chaos_proven",
    // Re-run at 19b8aacc after the day's later changes. A proof pins the commit
    // it was obtained at for a reason: evidence about earlier code is evidence
    // about code that is no longer running.
    observedAt: "2026-08-22T23:55:00.000Z",
    commit: "19b8aacc",
    method:
      "npx tsx scripts/proof-rollback.ts against the PRODUCTION database as an authenticated admin. Captured a representative state (an existing engine_briefs row, every column read byte-for-byte, plus the content_items count); performed the controlled mutation engine_assemble_draft actually makes — a draft content_item plus its source_records and media_requirements children, and an UPDATE moving the borrowed brief's state; then planned and executed the reversal through src/lib/engine/rollback.ts and compared every captured value individually rather than counting rows. The two refusal arms were GENUINELY INDUCED in the database rather than simulated: the row was really set to status='published' (with published_at a year in the future, so the induced state is invisible to the public — asserted, not assumed, by querying as anon), and really edited by hand as an editor would. The target state for the update is chosen to differ from what is already there, because an earlier run happened to borrow a brief already in the target state, mutated nothing, 'restored' a value that had never moved, and reported 10/10.",
    observed:
      "11/11 checks passed. The mutation was verified real before reversal (state 'drafting' -> 'planned'). A genuinely PUBLISHED row refused the ENTIRE plan — refusals=[row_published], and critically the source_records row was NOT deleted, so a published article never loses its sources to a half-reversal. A genuinely EDITED row also refused the entire plan — refusals=[row_modified_since] — so the editor's title was not discarded. Anon saw 0 rows for the induced published state, confirming it never reached a reader. The clean run then planned '4 reversal(s): 1 restore then 3 deletes, children before parents', executed it, and afterwards: the created draft, source_records row and media_requirements row were all absent; the updated brief held EXACTLY its previous values {state:'drafting', review_state:'pending'}; the `rationale` column — which the engine never wrote — was byte-identical, proving only the recorded columns are restored; and content_items was back to exactly 81, the count before the run.",
    passed: true,
  },
  {
    kind: "provider_outage_test",
    level: "chaos_proven",
    observedAt: "2026-08-22T21:50:00.000Z",
    commit: "27217539",
    method:
      "src/lib/media/providers/chaos-provider-outage.test.ts (16 tests). Ran runAcquisitionPipeline for 'GoPro HERO13 Black' against a REAL node:http server on loopback, reached by the provider's own fetch, replaying the verbatim Commons responses captured the same day. Ten real transport/protocol failures induced in turn: connection refused on a dead port (genuine ECONNREFUSED), a client timeout against a server that accepts and never answers (genuine AbortSignal), a socket destroyed mid-request, HTTP 500/502/503/429, HTTP 200 carrying Wikimedia's HTML error page, HTTP 200 carrying an HTML 'Too Many Requests' page, HTTP 200 carrying a MediaWiki error object, and HTTP 200 carrying valid JSON with query.search absent — the case with no exception to catch. Two controls: the same fixtures unfaulted, and a well-formed genuinely-empty answer.",
    observed:
      "Every induced failure reported PROVIDER_OUTAGE or PROVIDER_PARSE_FAILURE. NOT ONE reported NO_RESULTS, which is the property that matters: an outage must never be indistinguishable from an exhausted search. All reported proposedRow=null, publicationSafety=null, ranking=null, zero accepted, with the real status line preserved in the explanation and responsesFailed>0 in the attestation. The controls prove the harness is not simply broken: unfaulted reached USABLE_CANDIDATE_FOUND with 3 accepted candidates, and a well-formed empty answer reached NO_RESULTS with responsesParsed>0, responsesFailed=0 and no anomalies. The run also exposed a defect: with one HTTP 500 on the metadata batch, search() drops its accumulated hardFailure and the pipeline reports WRONG_ENTITY_RESULTS — a positive claim that none of the material is this product — for the same three files that otherwise clear every gate.",
    passed: true,
  },
  {
    kind: "media_validation_outage_test",
    level: "chaos_proven",
    observedAt: "2026-08-22T21:52:00.000Z",
    commit: "27217539",
    method:
      "src/lib/media/providers/chaos-validation-outage.test.ts (15 tests). Served the verbatim captured Commons discovery responses so three real, well-licensed CC BY-SA 4.0 candidates existed on every run, then injected the fault into the RESOLVE call that carries the entire evidence base: HTTP 500; a destroyed socket; revisions stripped so the raw-wikitext licence read dies while the rendered badge survives; revisions and extmetadata both stripped; the two licence reads made to disagree; the surviving read made NonCommercial; HTML instead of JSON; a body with no query.pages; a second permission= field making the field reader's own output unbelievable; and a real TypeError thrown from the validation stage itself.",
    observed:
      "Fail-closed in every case. Zero candidates accepted, proposedRow=null, publicationSafety=null, ranking=null, and NO evaluation anywhere produced writableRightsStatus === 'pending_verification' (only null or 'restricted'), with mayAcquire=false and mayPublish=false throughout. The fault was NAMED rather than reported as a clean negative: 500 and destroyed socket -> PROVIDER_OUTAGE; badge-only -> RIGHTS_UNCERTAIN with blocker licence_not_in_primary_source on all three while still recording the unused badge value; both reads dead -> licence_absent; disagreeing reads -> rights_conflicting with no friendlier reading chosen; NonCommercial -> restricted; HTML and unknown shape -> PROVIDER_PARSE_FAILURE. The unreadable permission= field was refused as provider_malformed — 'says the reader is wrong, not the file' — explicitly NOT as rights_conflicting, which is the mistake that made the original |other versions= regression invisible. A throw propagated out with no report fabricated. Control: unfaulted, all three reached evidence_complete and validateEnginePublicationSafety().safe = true.",
    passed: true,
  },
  {
    kind: "media_acquisition_test",
    level: "integration_proven",
    // Re-run at c4890ab AFTER the embedded-rights reader was tightened. That
    // re-run is the load-bearing part: a stricter rights check that refuses the
    // known-good control is not safer, it is broken, and the only way to know
    // which one you have is to run the control again.
    observedAt: "2026-08-23T00:25:00.000Z",
    commit: "c4890ab",
    method:
      "npx tsx scripts/proof-media-acquisition.ts — the full pipeline for 'GoPro HERO13 Black' against the LIVE Wikimedia Commons API (2500ms spacing, descriptive User-Agent, capped so the run costs 8 API requests), then downloading Commons' own 1920px derivative of the winner, reading its real pixel dimensions out of the JPEG SOF marker, SHA-256'ing the bytes, building the media_assets row and putting it through validateEnginePublicationSafety() and evaluatePublishEligibility(). The script imports no Supabase client at all. RE-RUN after the metaValue() EXIF fix so the record describes current code rather than the code it was first obtained on.",
    observed:
      "8 live requests, re-run after the UsageTerms/unreadable-field hardening and still PASSING, which is what shows the stricter reader does not over-fire on legitimate material. Strict lookup 'GoPro HERO13 Black' accepted 0 of 6 categories; 'GoPro HERO 13 Black' accepted Category:GoPro Hero 13 black and Category:GoPro Héro 13 black and refused Category:Taken with GoPro Hero13 Black as a capturing-device category. 8 files enumerated, 3 resolved, 3 accepted, licence read from raw wikitext {{self|cc-by-sa-4.0 -> CC BY-SA 4.0, corroborated by extmetadata LicenseShortName='CC BY-SA 4.0', creator 'François de Dijon'. Winner File:GoPro Héro 13 Black - 02.jpg, declared an effective tie at 0.9777. Download HTTP 200 image/jpeg, 87,344 bytes, 1920x1281 measured from the bytes themselves. Proposed row: rights_status='pending_verification', publication_status='private', owned=false, source_type='public_domain_or_cc'. evaluatePublishEligibility() allowed=FALSE; evaluateProvenance() rights_uncertain, publishable=false, blocker rights_unverified; validateEnginePublicationSafety().safe=true, meaning the row the engine would write is CORRECTLY REFUSED. Nothing was written to the database or to storage.",
    passed: true,
  },
  {
    kind: "rights_verification_test",
    level: "integration_proven",
    // SUPERSEDES the record obtained earlier the same day at commit 27217539.
    // That record said passed:true, and it was describing code that let the
    // flagship counterexample through. Kept as a replacement rather than an
    // addition, because two records for one kind would let the weaker one be
    // read as corroboration.
    observedAt: "2026-08-23T00:10:00.000Z",
    commit: "e12cb00",
    method:
      "npx tsx scripts/proof-rights-verification.ts against the live Wikimedia Commons API — 10 requests, 2500ms spacing, project User-Agent, nothing written to database or storage. Eight files, one per arm of the check, including two found live by insource: search. Each file's raw wikitext licence, its extmetadata licence, its EMBEDDED rights metadata as this code actually receives it, the conflicts and the verdict are all printed verbatim.",
    observed:
      "1 evidence_complete (writable 'pending_verification'), 2 restricted, 4 evidence_conflicting (writable null), 1 evidence_incomplete (writable null). NonCommercial and NoDerivatives both refused from the raw wikitext against a disagreeing badge. Badge-only plus an unreviewed third-party YouTube re-licence refused. INVARIANT HELD: no file produced a writable rights status above 'pending_verification'. THE FINDING THIS PROOF EXISTS TO RECORD: File:Canon EOS 5D.jpg — the file this project has cited for months as the reason the EXIF cross-check exists — was STILL not blocked after the lang-structured-value fix, and came out evidence_complete with mayAcquire=true. Two separate defects wearing the same costume. First, its EXIF Copyright is only a bare notice ('©2008 Charles Lanteigne'), which is correctly NOT a conflict — CC does not waive copyright. The actual reservation lives in commonmetadata.UsageTerms ('No Usage Rights Granted Without Written Authorization from Charles Lanteigne'), a field resolve() never read at all. Second, that sentence matched none of the reservation patterns, which had been written from the phrase a human once quoted rather than from what the file actually says. It now reads as evidence_conflicting with writable=null, as does File:Canon AE-1 with 50mm f1.8 S.C. II.jpg, which carries the same reservation in flat form. Also closed: metaValue() returned the FIRST readable entry, and resolve() concatenates commonmetadata ahead of metadata — so a benign value in the first bucket silently silenced a restrictive value in the second. Disagreement between the buckets is now a conflict in both orders rather than resolved by position.",
    passed: true,
  },
  {
    kind: "circuit_breaker_test",
    level: "chaos_proven",
    observedAt: "2026-08-22T22:00:00.000Z",
    commit: "27217539",
    method:
      "src/lib/engine/chaos/circuit-breaker-chaos.test.ts (15 tests). Established a control of ten nights of healthy engine_job_runs and confirmed all eight breakers closed and all six capabilities runnable. Then induced four faults end to end and let production code derive the breaker inputs from what actually happened: a runaway creation event (a carrier stage really created 60 records against a fault-injected database); a stage that silently stopped being invoked; total telemetry loss; and an unregistered stage asking for a gate while every capability was halted. Then tripped each of the eight breakers in isolation and traced each halt through the real ALL_CAPABILITIES / isHalted / capabilityOf / haltReason to the per-job gate.",
    observed:
      "Control: open=[none], halted=[none], jobsRefused=0/15. Runaway: a green status=success created=60 pass produced createdLast24h=61 against hardCeiling=25; publication_volume opened and engine_briefs, engine_draft_assembly and engine_product_assembly were refused while discovery, classification and maintenance kept running. Stage-stopped: job_interval opened with overdueNames='engine_relevance'. Telemetry loss: publication_volume opened with basis=no_data and silent_success opened, while source_failures and database_errors correctly stayed CLOSED — the halt is a decision, not a panic. Unregistered stage: capabilityOf('engine_shadow_evaluation')=null -> refused. All eight breakers tripped, each halted exactly the capabilities it declares and no others, each carried a why >40 chars and an action, and database_errors at consecutiveFailedRuns:3 left stillRunnable=[none] and refused 15/15 jobs. CAVEAT CARRIED: links 1-4 of the chain execute as the real production functions, but link 5 — guard.gateFor()'s wrapper and the tick route's `if (!gate.allow) continue` — is server-only/Next-only and was NOT executed; it is quoted verbatim in the harness and reproduced there. Halting 'publication' refuses nothing, because no registered stage carries that capability.",
    passed: true,
  },
  {
    kind: "source_outage_test",
    level: "chaos_proven",
    observedAt: "2026-08-22T22:05:00.000Z",
    commit: "27217539",
    method:
      "src/lib/engine/chaos/source-outage-chaos.test.ts (9 tests). Stood up throwaway node:http servers on loopback and genuinely broke them: 'gone' binds a port then closes the listener so the OS really refuses the connection; 'hangs' accepts and never answers so a real AbortController fires; 'server_error' really returns 503; 'moved' serves a real HTML page at HTTP 200; 'empty_feed' serves a well-formed feed with zero entries as the control. Every error string asserted against is what Node and this machine actually produced. Each real observation was fed through the real parseFeed, errorFamily, classifyStageOutcome, incidentFor, evaluateBreakers, capabilityOf and haltReason.",
    observed:
      "Connection refused produced the real 'TypeError: fetch failed' -> PROVIDER_FAILURE with a reason containing 'THE WORK DID NOT HAPPEN', NEVER NOTHING_TO_DO. HTTP 503 -> PROVIDER_FAILURE. A real read timeout -> PROVIDER_FAILURE. The moved feed (HTTP 200, 155 bytes, parseFeed items=0, looksLikeFeed=false) -> PARSER_FAILURE at critical severity, not an empty shelf. Control: a well-formed feed with zero entries -> NOTHING_TO_DO with incident=null, so the detector distinguishes quiet from broken. Propagation: five real polls of the dead port -> maxConsecutiveFailures=5 -> source_failures OPEN -> discovery removed from stillRunnable -> engine_discover refused with an actionable reason, while engine_relevance kept running. CAVEATS CARRIED: this proves the RULE rather than the identity of runDiscovery/safeFetchText, which are server-only and whose logic is replicated; the breaker's real input is written through engine_record_source_check, whose no-op the discovery job declares blind; and five QUIET passes trip the same breaker, because parseFeed returns [] for both an HTML page and a legitimately empty feed.",
    passed: true,
  },
  {
    kind: "database_failure_test",
    level: "chaos_proven",
    // WAS passed:false. The record refused to be narrowed to the write paths
    // it covered; the read side has now been closed rather than redefined, so
    // it passes on the ORIGINAL definition. The three residuals below are part
    // of the record, not footnotes to it.
    observedAt: "2026-08-23T00:40:00.000Z",
    commit: "3d3e645",
    method:
      "src/lib/engine/chaos/database-failure-chaos.test.ts (14 tests, fault injection unchanged) plus denied-read-halt.test.ts (12) and queue-read.test.ts (10). Loud faults: 42501, PGRST202, a thrown connection loss, an errored queue read. SILENT faults, all with error: null — {data: [], error: null} and {data: null, error: null} on writes, an unenumerated 'rejected_invalid', and {data: [], error: null} on the input QUEUE READ. The read side is now traced through the real concludeQueueRead -> classifyStageOutcome -> the engine_job_runs row -> assessEngineHealth -> breakerInputsFromRuns -> evaluateBreakers -> capabilityOf/haltReason to the per-job gate, composed the same way guard.ts composes it.",
    observed:
      "THE WRITE SIDE FAILS CLOSED COMPLETELY, unchanged from the earlier failed record. THE READ SIDE NOW ALSO FAILS CLOSED, which is what that record was waiting on. A silently-denied queue read no longer writes status=success: 12 stages build an InputProbe from what the read actually returned and record status=failed with every counter zero when emptiness is UNPROVEN — a different row from the corroborated-empty row, differing in both status and has_error. WITH NO HISTORY, which is how the 2026-08 grants incident survived weeks: health.ts raises CRITICAL input_unproven on the FIRST such run (observed.priorRuns=0), the new health_findings breaker opens on it, and creation/media_acquisition/publication are halted with engine_briefs and engine_product_assembly refused, while classification and maintenance keep running so the problem stays diagnosable. WITH HISTORY: the CRITICAL zero_processing_anomaly that previously halted nothing now opens the breaker. THE CONTROL HOLDS: a corroborated empty queue records success and halts nothing, so the detector distinguishes a denied queue from an empty one rather than treating quiet as broken. THREE RESIDUALS, RECORDED RATHER THAN ROUNDED AWAY. (1) The halt lands on the NEXT tick, because buildGuard runs before the stages. Accepted as fail-closed for THIS failure class, and the reasoning is stated so it can be disputed: detection is immediate — the stage records failed and the tick returns ok:false within the same pass — and a stage whose queue read was denied has no input rows, so it creates nothing in the interval. There is no window in which damage occurs; what is delayed is defence-in-depth against the cause spreading. (2) A control read excludes a BLANKET loss of grants but not a defect inside a queue function's own body. Verified concretely: engine_assemblable_briefs opens with `if not engine_flag_enabled('research') then return; end if;`, so an early return there is indistinguishable from a denial under control-read evidence. This is a different failure class from the RLS silent-zero-rows one this proof names — a revoked EXECUTE answers PGRST202, which is an error the job already fails on — but it is a real unclosed hole and needs the unfiltered count drafted in supabase/migrations_pending/20260823_queue_probe_and_stage_outcome.sql. (3) A creation-capability job raising input_unproven latches the halt until the 336h window rolls, because tick/route.ts records no job-run row for a halted stage. Same class as the pre-existing silent_success latch. NOT COVERED: guard.gateFor's wrapper and the tick route's `if (!gate.allow) continue` remain readable-but-unexecuted, because both import server-only.",
    passed: true,
  },
];
