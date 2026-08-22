// Validator availability probes.
//
// The circuit-breaker rule is that an unavailable validator means STOP, never
// "proceed without validating". That rule is worth nothing unless something
// actually establishes whether the validators are working — otherwise
// "available" is just an assumption with a boolean next to it.
//
// So each probe below runs the real validator against a fixture whose correct
// answer is not in doubt, and reports it unavailable if the answer comes back
// wrong. This catches the case that matters: not "the module is missing" (the
// build would fail) but "the module is present and no longer enforces what it
// says it enforces" — a refactor that made a guard permissive, which is exactly
// the kind of change that produces no error anywhere.
//
// Pure and synchronous, so the probes themselves are unit-testable.

import { evaluatePublishEligibility } from "../media/rights.ts";
import { decideValidation, type ValidatorStatus } from "./circuit-breaker.ts";
import { classifyOutcome, expectRpcStatus } from "./postconditions.ts";

/**
 * Media rights: a `restricted` asset must never be publishable, whatever else
 * is true about it. This is the single hardest rule in the media model, and it
 * is asserted here with the most favourable possible surrounding facts (owned,
 * staff photograph) so a probe passing means the block genuinely wins.
 */
function probeMediaRights(): ValidatorStatus {
  const restricted = evaluatePublishEligibility({
    rights_status: "restricted",
    owned: true,
    source_type: "staff_photograph",
  });
  if (restricted.allowed) {
    return {
      validator: "media_rights",
      available: false,
      detail:
        "evaluatePublishEligibility() cleared a RESTRICTED asset. The rights gate no longer " +
        "enforces its most important rule",
    };
  }

  // The converse: it must still clear a genuinely verified asset, or every
  // media path is blocked for the wrong reason and someone will be tempted to
  // route around it.
  const verified = evaluatePublishEligibility({ rights_status: "verified" });
  if (!verified.allowed) {
    return {
      validator: "media_rights",
      available: false,
      detail: "evaluatePublishEligibility() refused a verified asset, so its verdicts cannot be trusted",
    };
  }

  return { validator: "media_rights", available: true };
}

/**
 * Postcondition verification: a mutation that returns no error and no data must
 * NOT classify as success. This is the anon/RLS signature, and it is the whole
 * reason src/lib/engine/postconditions.ts exists.
 */
function probePostconditions(): ValidatorStatus {
  const silent = classifyOutcome({
    operation: "probe",
    expectation: "a documented status string",
    outcome: { data: null, error: null },
    verify: expectRpcStatus(["created"]),
  });
  if (silent.ok) {
    return {
      validator: "postconditions",
      available: false,
      detail: "classifyOutcome() treated a null-data, null-error mutation as successful",
    };
  }

  const good = classifyOutcome({
    operation: "probe",
    expectation: "a documented status string",
    outcome: { data: "created", error: null },
    verify: expectRpcStatus(["created"]),
  });
  if (!good.ok) {
    return {
      validator: "postconditions",
      available: false,
      detail: "classifyOutcome() rejected a correctly-completed mutation, so its verdicts cannot be trusted",
    };
  }

  return { validator: "postconditions", available: true };
}

/**
 * The fail-closed rule itself: an empty validator roster must stop the engine.
 * If this probe fails, every other probe here is meaningless, because a missing
 * validator would no longer halt anything.
 */
function probeFailClosedRule(): ValidatorStatus {
  const empty = decideValidation([]);
  const missing = decideValidation([{ validator: "x", available: false }]);
  if (empty.decision !== "stop" || missing.decision !== "stop") {
    return {
      validator: "fail_closed_rule",
      available: false,
      detail: "decideValidation() no longer stops on an absent or unavailable validator",
    };
  }
  return { validator: "fail_closed_rule", available: true };
}

/**
 * The roster the engine checks before it is allowed to create anything.
 *
 * Additional validators (evidence scoring, provenance) are expected to register
 * here as they land. An empty roster is itself a stop condition, so this list
 * shrinking to nothing halts the engine rather than silently clearing it.
 */
export function probeCoreValidators(): ValidatorStatus[] {
  return [probeMediaRights(), probePostconditions(), probeFailClosedRule()];
}
