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
    observedAt: "2026-08-22T22:40:00.000Z",
    commit: "27217539",
    method:
      "npx tsx scripts/proof-media-acquisition.ts — the full pipeline for 'GoPro HERO13 Black' against the LIVE Wikimedia Commons API (2500ms spacing, descriptive User-Agent, capped so the run costs 8 API requests), then downloading Commons' own 1920px derivative of the winner, reading its real pixel dimensions out of the JPEG SOF marker, SHA-256'ing the bytes, building the media_assets row and putting it through validateEnginePublicationSafety() and evaluatePublishEligibility(). The script imports no Supabase client at all. RE-RUN after the metaValue() EXIF fix so the record describes current code rather than the code it was first obtained on.",
    observed:
      "8 live requests. Strict lookup 'GoPro HERO13 Black' accepted 0 of 6 categories; 'GoPro HERO 13 Black' accepted Category:GoPro Hero 13 black and Category:GoPro Héro 13 black and refused Category:Taken with GoPro Hero13 Black as a capturing-device category. 8 files enumerated, 3 resolved, 3 accepted, licence read from raw wikitext {{self|cc-by-sa-4.0 -> CC BY-SA 4.0, corroborated by extmetadata LicenseShortName='CC BY-SA 4.0', creator 'François de Dijon'. Winner File:GoPro Héro 13 Black - 02.jpg, declared an effective tie at 0.9777. Download HTTP 200 image/jpeg, 87,344 bytes, 1920x1281 measured from the bytes themselves. Proposed row: rights_status='pending_verification', publication_status='private', owned=false, source_type='public_domain_or_cc'. evaluatePublishEligibility() allowed=FALSE; evaluateProvenance() rights_uncertain, publishable=false, blocker rights_unverified; validateEnginePublicationSafety().safe=true, meaning the row the engine would write is CORRECTLY REFUSED. Nothing was written to the database or to storage.",
    passed: true,
  },
  {
    kind: "rights_verification_test",
    level: "integration_proven",
    observedAt: "2026-08-22T22:35:00.000Z",
    commit: "27217539",
    method:
      "npx tsx scripts/proof-rights-verification.ts — resolved seven real Wikimedia Commons files through the live API (9 requests, 2500ms spacing) and ran verifyRights() on the real provenance, printing per file what was read from the raw wikitext, what was read from extmetadata, whether the two agree, the EXIF as this code actually receives it, the conflicts and the verdict. Targets were found by live insource:/intitle: searches for genuine NonCommercial and NoDerivatives templates, genuine 'all rights reserved' text, and the video-frame class. RE-RUN after the metaValue() fix, because the first run of this proof is what exposed the EXIF arm being broken.",
    observed:
      "NonCommercial refused: File:Plumedbasiliskcele4.jpg, wikitext {{cc-by-nc against extmetadata 'CC BY-SA 3.0' -> restricted, blockers licence_prohibitive + licence_metadata_mismatch. NoDerivatives refused: File:Raduno Vicenza 2006 0078.JPG, wikitext {{Cc-by-nd -> restricted, same blockers. Conflicting evidence blocked in three independent shapes: File:Silver crystal.jpg (wikitext 'CC BY-SA 3.0' vs extmetadata 'CC BY-SA 3.0 de'), File:Copper Alloy crotal bell (FindID 287885).jpg (populated permission field; its author field literally reads 'All rights reserved, Andrew Richardson'), and a PermissionTicket file. Badge-only plus third-party re-licence refused: the Geekerwan 9800X3D video frame, no licence template in the wikitext at all against extmetadata 'CC BY 3.0' -> licence_not_in_primary_source + third_party_relicence_unreviewed. Positive control File:GoPro Héro 13 Black - 01.jpg: both reads CC BY-SA 4.0, evidence_complete, writable exactly 'pending_verification', mayPublish=false. Prohibitive templates beat permissive ones on the same page. INVARIANT HELD: no file produced a writable rights status above 'pending_verification'. On the re-run the EXIF arm reads real text — File:Canon EOS 5D.jpg now records EXIF Copyright=\"©2008 Charles Lanteigne\" instead of the literal \"[object Object],[object Object]\" it recorded before the fix — and correctly raises no conflict, since a copyright notice naming the photographer is not a reservation of rights.",
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
    observedAt: "2026-08-22T22:10:00.000Z",
    commit: "27217539",
    method:
      "src/lib/engine/chaos/database-failure-chaos.test.ts (14 tests). A stage wired the way jobs/discovery.ts is wired was run against a fault-injected database returning the literal supabase-js bytes for each fault. Loud forms: 42501 permission denied, PGRST202 function-not-in-schema-cache, a thrown connection loss, an errored queue read. SILENT forms, the centrepiece, all with error: null: {data: [], error: null} on writes, {data: null, error: null} on writes, an honest-but-unenumerated 'rejected_invalid', and {data: [], error: null} on the input QUEUE READ. Each was traced through the real classifyOutcome / postcondition log / detectSilentSuccess / assessEngineHealth / breakerInputsFromRuns / evaluateBreakers to the per-job capability gate.",
    observed:
      "THE WRITE SIDE FAILS CLOSED COMPLETELY. 42501 -> status=failed, PERMISSION_FAILURE. PGRST202 -> PERMISSION_FAILURE, not 'unknown'. Connection loss -> the pass survived and recorded errored=3 rather than aborting. Silent zero-rows write -> errored=0 (no error was returned) but unverifiable=3, counters.failed=3, status=failed. 'rejected_invalid' -> silentNoOps=3 and deduped=0, so a rejection was NOT filed as a benign duplicate. Propagation: three induced 42501 runs moved the engine from stillRunnable=[all six] to open=[database_errors], stillRunnable=[none], 15/15 jobs refused; healing restored all six. THE READ SIDE DOES NOT FAIL CLOSED, and that is why this record is passed:false. A silently-denied QUEUE READ still writes status=success with examined=0, byte-identical to an empty queue. With ten nights of history, health.ts raises a CRITICAL zero_processing_anomaly (medianExamined:22) but breakers.healthy stays TRUE and every job is still allowed — no HealthFinding of any severity maps to any breaker. With no history at all: zero critical findings, silentSuccess.clean=true, breakers healthy — never_effective requires examined>0 and zero_processing_anomaly requires medianExamined>=1, so a stage denied FROM BIRTH is completely invisible, which is exactly how the 2026-08 grants incident survived weeks. The only module that separates a denied read from an empty one is classifyStageOutcome, and it has zero production callers.",
    // FALSE, DELIBERATELY.
    //
    // The write half of this is genuinely, thoroughly proven. The read half —
    // this project's signature failure — is not: undetected without history,
    // and detected-but-halting-nothing with it.
    //
    // The tempting move is to split this into a passing record scoped to
    // "mutation paths" and a failing one for "read paths". That narrowing is
    // precisely how a proof becomes a reassurance, so it is not taken. proofs.ts
    // says there is no partial credit, and a partially-proven fail-closed is an
    // unproven one.
    passed: false,
  },
];
