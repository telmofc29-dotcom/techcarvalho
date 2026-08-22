import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyProposedChange,
  classifyUpdateSignal,
  proposedChanges,
  stripChangePrefix,
} from "./update-signals.ts";

test("a firmware story is an update, not a new article", () => {
  const s = classifyUpdateSignal("Canon releases firmware 1.8.1 for the EOS R5");
  assert.equal(s?.reason, "firmware_update");
});

test("discontinuation is detected and outranks other wording", () => {
  const s = classifyUpdateSignal("Sony discontinues the A7 III as prices drop");
  assert.equal(s?.reason, "discontinued");
});

test("a plain new-product story is NOT an update", () => {
  assert.equal(classifyUpdateSignal("Framework announces a new 16-inch laptop"), null);
});

test("null is returned rather than a guessed reason", () => {
  for (const t of ["Our thoughts on mesh networking", "Best gaming headsets", ""]) {
    assert.equal(classifyUpdateSignal(t), null, t);
  }
});

test("every signal explains itself and cites what it matched", () => {
  const s = classifyUpdateSignal("RTX 5080 price cut announced");
  assert.ok(s);
  assert.ok(s.matchedOn.length > 0);
  assert.ok(s.explanation.includes(s.matchedOn));
  assert.ok(s.explanation.includes("rather than as a new article"));
});

test("confidence never reaches certainty", () => {
  const titles = [
    "Canon firmware 2.0 released",
    "Sony discontinues the A7 III",
    "RTX 5080 price cut",
    "Report retracted",
  ];
  for (const t of titles) {
    const s = classifyUpdateSignal(t);
    assert.ok(s && s.confidence > 0 && s.confidence < 1, t);
  }
});

test("the summary is searched, not just the title", () => {
  const s = classifyUpdateSignal("Canon EOS R5", "The camera is now discontinued in Europe.");
  assert.equal(s?.reason, "discontinued");
});

test("proposed changes keep verified and unverified apart", () => {
  const changes = proposedChanges({
    verifiedFacts: ["Price is now $399."],
    uncertainties: ["A successor may arrive in 2027."],
  });
  assert.ok(changes[0].startsWith("Verified — may be stated directly:"));
  assert.ok(changes[1].startsWith("Unverified — attribute or omit:"));
});

test("the verified/unverified split survives a round trip through storage", () => {
  const changes = proposedChanges({
    verifiedFacts: ["Price is now $399."],
    uncertainties: ["A successor may arrive in 2027."],
  });
  assert.equal(classifyProposedChange(changes[0]), "verified");
  assert.equal(classifyProposedChange(changes[1]), "unverified");
  assert.equal(stripChangePrefix(changes[0]), "Price is now $399.");
  assert.equal(stripChangePrefix(changes[1]), "A successor may arrive in 2027.");
});

test("an unrecognised change line is unclassified, never assumed verified", () => {
  for (const line of ["Consider incorporating: a spec bump", "", "Verified elsewhere: nope"]) {
    assert.equal(classifyProposedChange(line), "unclassified", line);
    assert.equal(stripChangePrefix(line), line, line);
  }
});
