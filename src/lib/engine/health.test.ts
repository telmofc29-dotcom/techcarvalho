import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedCadenceHours, TICK_CADENCE_HOURS } from "./health.ts";

test("expected cadence comes from the declared schedule, not observed gaps", () => {
  // The bug this replaced: expectedIntervalHours was the job's own observed
  // median gap between runs. Manual invocations during development dragged it
  // to 1.03h for a job scheduled every 24h, so the breaker declared a healthy
  // nightly job overdue after two hours and halted creation, media acquisition
  // and publication.
  //
  // A breaker that opens permanently on a false signal is not fail-closed. It
  // is broken, and worse than absent, because it trains an operator to ignore
  // the one alarm that is supposed to mean something.
  assert.equal(expectedCadenceHours(1.03), TICK_CADENCE_HOURS,
    "manual-run pollution must not shorten the expectation");
  assert.equal(expectedCadenceHours(0.1), TICK_CADENCE_HOURS);
  assert.equal(expectedCadenceHours(24), TICK_CADENCE_HOURS);
});

test("a job genuinely running less often than the tick keeps its own cadence", () => {
  // The mirror bug: judging a weekly job against a daily schedule would
  // declare it overdue every single day.
  assert.equal(expectedCadenceHours(168), 168);
  assert.equal(expectedCadenceHours(48), 48);
});

test("the declared cadence matches the cron schedule in vercel.json", () => {
  // vercel.json runs /api/engine/tick at "30 4 * * *" — once a day. If that
  // schedule changes, this constant must change with it, and this assertion is
  // what makes that a deliberate act rather than a silent drift.
  assert.equal(TICK_CADENCE_HOURS, 24);
});
