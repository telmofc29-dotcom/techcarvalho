import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// review_state='approved' MEANS A HUMAN DECIDED. NOTHING ELSE MAY WRITE IT.
//
// brief-quality.ts documents review_state as "what a human decided" and
// draft-job.ts guards draft assembly on it: "A HUMAN must have approved the
// brief". That made it the one gate standing between the engine and
// unsupervised article production.
//
// Two scripts wrote it anyway, with a reviewed_at timestamp, purely so their
// own brief rows looked settled. Neither needed it — both call assembleDraft
// directly, so approval was never a precondition for anything they do. The
// result was 52 briefs marked approved that no owner had ever seen, 9 of them
// stamped inside a single minute, and every report citing the approved count as
// evidence about owner control was reporting a machine's own writes back as the
// owner's decisions.
//
// The harm was bounded — approving a brief yields a DRAFT, and the assemble RPC
// hard-codes status='draft' — so it cost a queue to triage rather than a live
// page. But a gate the machine can satisfy on the owner's behalf is not a gate,
// and it was invisible precisely because the field looked correct in a query.
//
// Server Actions under src/app/admin are the legitimate writer: those run only
// when a signed-in admin clicks approve.

/**
 * Verification probes that deliberately seed an approved brief to exercise the
 * assembly path end to end, and remove it afterwards. Allowed by name so the
 * exemption is explicit rather than a hole anyone can wander into.
 */
const ALLOWED = [
  "verify-engine-assemble.ts",
  "verify-production-state.ts",
  // Exercises the CHECK constraint that refuses an approval with no actor.
  // Proving that approved-without-reviewed_by is REFUSED requires attempting
  // it, and proving approved-with-an-actor still works requires performing
  // one. It removes every row it creates and asserts the count is unchanged.
  "verify-review-actor.ts",
  // The adversarial pass. It ATTEMPTS to approve a brief as an attacker would,
  // and asserts the attempt is refused — the write is the test. It targets
  // rows that cannot exist, so a hole would be proven without leaving one.
  "attack-surface.ts",
];

/** The write this test forbids, in either quote style. */
const APPROVES = /review_state\s*:\s*["']approved["']/;

/**
 * Strip comments before matching.
 *
 * The first version of this test failed on the comment that EXPLAINS the bug,
 * which would have made the honest thing — writing down what went wrong, next
 * to the fix — impossible.
 */
function withoutComments(src: string): string {
  const blocks = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
  const lines = new RegExp("//[^\\n]*", "g");
  return src.replace(blocks, " ").replace(lines, " ");
}

function isAllowed(file: string): boolean {
  const norm = file.replace(/\\/g, "/");
  return ALLOWED.some((name) => norm.endsWith(`/${name}`));
}

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) filesUnder(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

test("no script approves a brief on the owner's behalf", () => {
  const offenders: string[] = [];
  for (const file of filesUnder("scripts")) {
    if (isAllowed(file)) continue;
    if (APPROVES.test(withoutComments(readFileSync(file, "utf8")))) {
      offenders.push(`${file} writes review_state:'approved'`);
    }
  }
  assert.deepEqual(offenders, [], `\n${offenders.join("\n")}`);
});

test("the engine's own jobs never approve a brief either", () => {
  const offenders: string[] = [];
  for (const file of filesUnder("src/lib/engine")) {
    if (APPROVES.test(withoutComments(readFileSync(file, "utf8")))) {
      offenders.push(`${file} writes review_state:'approved'`);
    }
  }
  assert.deepEqual(offenders, [], `\n${offenders.join("\n")}`);
});

test("the comment-stripper does not hide a real write", () => {
  // Guard the guard: if withoutComments were too greedy it would silently
  // disarm both tests above.
  const real = `const row = { review_state: "approved" };`;
  assert.ok(APPROVES.test(withoutComments(real)));
  assert.ok(!APPROVES.test(withoutComments(`// review_state: "approved"`)));
  assert.ok(!APPROVES.test(withoutComments(`/* review_state: "approved" */`)));
});
