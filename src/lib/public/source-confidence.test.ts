import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessSourceConfidence,
  shouldShowConfidence,
  confidenceLabel,
  type PublicSource,
} from "./source-confidence.ts";

const secondary = (url: string, publisher: string): PublicSource => ({
  url,
  publisher,
  reliabilityTier: "secondary",
});

test("no sources yields null, not a weak band", () => {
  // A story with nothing recorded has not been judged badly; it has not been
  // judged. Labelling it "Rumour" would invent a finding.
  assert.equal(assessSourceConfidence([]), null);
});

test("a primary source is Confirmed", () => {
  const r = assessSourceConfidence([
    { url: "https://www.canon.co.jp/news/2026/r5iii", publisher: "Canon", reliabilityTier: "primary" },
  ]);
  assert.equal(r?.band, "confirmed");
  assert.equal(r?.independentVoices, 1);
});

test("two independent outlets are Strongly supported, not Confirmed", () => {
  // Corroboration between reporters is not confirmation by the company.
  const r = assessSourceConfidence([
    secondary("https://www.dpreview.com/news/a", "DPReview"),
    secondary("https://www.theverge.com/b", "The Verge"),
  ]);
  assert.equal(r?.band, "strongly_supported");
  assert.equal(r?.independentVoices, 2);
});

test("one outlet is a Single-source report", () => {
  const r = assessSourceConfidence([secondary("https://www.dpreview.com/news/a", "DPReview")]);
  assert.equal(r?.band, "single_source");
});

test("TEN ARTICLES COPYING ONE REPORT ARE NOT TEN CONFIRMATIONS", () => {
  // The invariant the whole module exists for. Nine outlets each with their own
  // domain, all repeating one story, must not out-rank two outlets that each
  // did their own reporting — because they are pages, not voices.
  const oneVoiceManyPages: PublicSource[] = Array.from({ length: 10 }, (_, i) =>
    secondary(`https://www.dpreview.com/news/story-${i}`, "DPReview")
  );
  const r = assessSourceConfidence(oneVoiceManyPages);
  assert.equal(r?.band, "single_source", "ten pages from one publisher is still one voice");
  assert.equal(r?.independentVoices, 1);
  assert.equal(r?.repeatedSources, 9);
});

test("adding more pages from a voice already counted never strengthens the band", () => {
  const base = [
    secondary("https://www.dpreview.com/news/a", "DPReview"),
    secondary("https://www.theverge.com/b", "The Verge"),
  ];
  const padded = [
    ...base,
    secondary("https://www.dpreview.com/news/a2", "DPReview"),
    secondary("https://www.dpreview.com/news/a3", "DPReview"),
    secondary("https://www.theverge.com/b2", "The Verge"),
  ];
  const a = assessSourceConfidence(base);
  const b = assessSourceConfidence(padded);
  assert.equal(a?.band, b?.band);
  assert.equal(a?.independentVoices, b?.independentVoices);
});

test("tracking parameters do not manufacture a second source", () => {
  const r = assessSourceConfidence([
    secondary("https://www.dpreview.com/news/a", "DPReview"),
    secondary("https://www.dpreview.com/news/a?utm_source=twitter", "DPReview"),
  ]);
  assert.equal(r?.independentVoices, 1);
  assert.equal(r?.band, "single_source");
});

test("community-only sourcing is Rumour, never Single-source report", () => {
  const r = assessSourceConfidence([
    { url: "https://forum.example.com/t/1", publisher: "CanonRumors forum", reliabilityTier: "community" },
    { url: "https://forum.other.com/t/2", publisher: "Other forum", reliabilityTier: "community" },
  ]);
  assert.equal(r?.band, "rumour_unconfirmed");
});

test("a primary source among community chatter still Confirms", () => {
  const r = assessSourceConfidence([
    { url: "https://forum.example.com/t/1", publisher: "Forum", reliabilityTier: "community" },
    { url: "https://www.canon.co.jp/news/x", publisher: "Canon", reliabilityTier: "primary" },
  ]);
  assert.equal(r?.band, "confirmed");
});

test("the conflicting flag outranks everything, including a primary source", () => {
  // A person read the sources and found them irreconcilable. That is worth more
  // than the tier of any one of them.
  const r = assessSourceConfidence(
    [{ url: "https://www.canon.co.jp/news/x", publisher: "Canon", reliabilityTier: "primary" }],
    { conflicting: true }
  );
  assert.equal(r?.band, "conflicting");
});

test("conflicting outranks developing when both are set", () => {
  const r = assessSourceConfidence([secondary("https://a.com/1", "A")], {
    conflicting: true,
    developing: true,
  });
  assert.equal(r?.band, "conflicting");
});

test("the unconfirmed flag forces Rumour despite reputable sourcing", () => {
  // The real case this exists for: a rumour tracker covered by three serious
  // outlets read as "Strongly supported", because reliability_tier grades the
  // publisher and not the claim.
  const wellSourcedRumour = [
    secondary("https://www.theverge.com/a", "The Verge"),
    secondary("https://www.eurogamer.net/b", "Eurogamer"),
    secondary("https://www.ign.com/c", "IGN"),
  ];
  assert.equal(assessSourceConfidence(wellSourcedRumour)?.band, "strongly_supported");
  assert.equal(
    assessSourceConfidence(wellSourcedRumour, { unconfirmed: true })?.band,
    "rumour_unconfirmed"
  );
});

test("unconfirmed outranks developing but yields to conflicting", () => {
  const s = [secondary("https://a.com/1", "A")];
  assert.equal(
    assessSourceConfidence(s, { unconfirmed: true, developing: true })?.band,
    "rumour_unconfirmed"
  );
  assert.equal(
    assessSourceConfidence(s, { unconfirmed: true, conflicting: true })?.band,
    "conflicting"
  );
});

test("the unconfirmed flag beats even a primary source", () => {
  // A company can announce something and the substance still be unsettled.
  assert.equal(
    assessSourceConfidence(
      [{ url: "https://canon.com/x", publisher: "Canon", reliabilityTier: "primary" }],
      { unconfirmed: true }
    )?.band,
    "rumour_unconfirmed"
  );
});

test("the developing flag is not inferred from sources", () => {
  // Nothing about a source list can imply a story is still moving. Absence of
  // the flag must mean "not flagged", never "checked and settled".
  const r = assessSourceConfidence([secondary("https://a.com/1", "A")]);
  assert.notEqual(r?.band, "developing");
});

test("no band exposes a numeric score anywhere in its public text", () => {
  // False precision check: an editorial judgement dressed as a decimal is
  // harder to argue with, not easier.
  const cases: Array<[PublicSource[], object]> = [
    [[{ url: "https://c.com/x", publisher: "Canon", reliabilityTier: "primary" }], {}],
    [[secondary("https://a.com/1", "A"), secondary("https://b.com/1", "B")], {}],
    [[secondary("https://a.com/1", "A")], {}],
    [[{ url: "https://f.com/1", publisher: "F", reliabilityTier: "community" }], {}],
    [[secondary("https://a.com/1", "A")], { developing: true }],
    [[secondary("https://a.com/1", "A")], { conflicting: true }],
    [[secondary("https://a.com/1", "A")], { unconfirmed: true }],
  ];
  for (const [sources, editorial] of cases) {
    const r = assessSourceConfidence(sources, editorial);
    assert.ok(r, "expected an assessment");
    assert.doesNotMatch(r.explanation, /\d+(\.\d+)?\s*%/, `percentage leaked: ${r.explanation}`);
    assert.doesNotMatch(r.label, /\d/, `digit in label: ${r.label}`);
  }
});

test("the chip appears on news and on nothing else", () => {
  assert.equal(shouldShowConfidence("news"), true);
  for (const t of ["review", "guide", "comparison", "troubleshooting"] as const) {
    assert.equal(shouldShowConfidence(t), false, `${t} must not carry a confidence chip`);
  }
});

test("every band has a distinct human label", () => {
  const bands = [
    "confirmed", "strongly_supported", "developing",
    "single_source", "rumour_unconfirmed", "conflicting",
  ] as const;
  const labels = bands.map(confidenceLabel);
  assert.equal(new Set(labels).size, bands.length);
  for (const l of labels) assert.ok(l.length > 0);
});
