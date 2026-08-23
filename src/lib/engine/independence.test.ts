import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessIndependence,
  canonicalUrl,
  extractUpstreamAttribution,
  hostOf,
  registrableDomain,
  sameDocument,
} from "./independence.ts";

// ---------------------------------------------------------------------------
// Canonical URL / host extraction
// ---------------------------------------------------------------------------

test("canonicalUrl folds scheme, www, trailing slash and fragment onto one form", () => {
  const forms = [
    "http://www.nvidia.com/en-us/news/thing/",
    "https://nvidia.com/en-us/news/thing",
    "https://www.NVIDIA.com/en-us/news/thing#specs",
  ];
  const canonical = forms.map((f) => canonicalUrl(f));
  assert.equal(canonical[0], "nvidia.com/en-us/news/thing");
  assert.deepEqual(new Set(canonical).size, 1, `expected one canonical form, got ${canonical.join(" | ")}`);
});

test("canonicalUrl strips campaign and referrer parameters but keeps real ones", () => {
  assert.equal(
    canonicalUrl("https://example.com/post?utm_source=rss&utm_medium=feed&id=42&fbclid=abc"),
    "example.com/post?id=42"
  );
});

test("canonicalUrl orders parameters so two writings of one URL compare equal", () => {
  assert.equal(
    canonicalUrl("https://example.com/p?b=2&a=1"),
    canonicalUrl("https://example.com/p?a=1&b=2")
  );
});

test("canonicalUrl folds an AMP variant onto the canonical page", () => {
  assert.equal(canonicalUrl("https://amp.example.com/story/amp/"), "example.com/story");
  assert.equal(canonicalUrl("https://example.com/story?outputType=amp"), "example.com/story");
});

test("canonicalUrl unwraps an aggregator that merely wraps someone else's URL", () => {
  assert.equal(
    canonicalUrl("https://news.google.com/rss/articles/CBM?url=https%3A%2F%2Fvendor.example%2Flaunch"),
    "vendor.example/launch"
  );
});

test("canonicalUrl refuses non-http schemes rather than returning a half-cleaned string", () => {
  assert.equal(canonicalUrl("javascript:alert(1)"), null);
  assert.equal(canonicalUrl("not a url"), null);
  assert.equal(canonicalUrl(null), null);
});

test("hostOf drops delivery-variant subdomains, registrableDomain groups a publisher", () => {
  assert.equal(hostOf("https://m.theverge.com/x"), "theverge.com");
  assert.equal(registrableDomain(hostOf("https://blogs.nvidia.com/blog/x")), "nvidia.com");
  assert.equal(registrableDomain(hostOf("https://newsroom.intel.com/x")), "intel.com");
  // Multi-label public suffix must not collapse to the suffix itself.
  assert.equal(registrableDomain(hostOf("https://www.bbc.co.uk/news")), "bbc.co.uk");
});

test("sameDocument sees through tracking parameters and AMP", () => {
  assert.equal(
    sameDocument("https://example.com/a?utm_source=x", "https://amp.example.com/a/amp"),
    true
  );
  assert.equal(sameDocument("https://example.com/a", "https://example.com/b"), false);
});

// ---------------------------------------------------------------------------
// Upstream attribution extraction
// ---------------------------------------------------------------------------

test("extractUpstreamAttribution recovers an explicit citation, in text and in HTML", () => {
  assert.equal(
    extractUpstreamAttribution("Big news today. Source: https://upstream.example/report", "https://outlet.example/a"),
    "https://upstream.example/report"
  );
  assert.equal(
    extractUpstreamAttribution(
      'Rumour roundup (via <a href="https://upstream.example/leak">Upstream</a>)',
      "https://outlet.example/a"
    ),
    "https://upstream.example/leak"
  );
});

test("extractUpstreamAttribution returns null rather than guessing an upstream", () => {
  assert.equal(extractUpstreamAttribution("A plain summary with https://somewhere.example/x in it", null), null);
  assert.equal(extractUpstreamAttribution("No links at all here.", null), null);
  assert.equal(extractUpstreamAttribution(null, null), null);
});

test("a publisher citing its own earlier article is not an upstream source", () => {
  assert.equal(
    extractUpstreamAttribution(
      "More detail — source: https://outlet.example/earlier-post",
      "https://outlet.example/a"
    ),
    null
  );
});

// ---------------------------------------------------------------------------
// The five cases the model must tell apart
// ---------------------------------------------------------------------------

test("CASE 1: two genuinely independent sources count as two voices", () => {
  const r = assessIndependence([
    { id: "a", url: "https://dpreview.com/review", originExamined: true },
    { id: "b", url: "https://theverge.com/hands-on", originExamined: true },
  ]);
  assert.equal(r.independentVoices, 2);
  assert.equal(r.echoedRows, 0);
  assert.equal(r.corroborationWeight, 1);
});

test("CASE 2: two URLs repeating one upstream report are one voice, not two", () => {
  const r = assessIndependence([
    { id: "a", url: "https://outlet-a.example/story", originatesFromUrl: "https://leaker.example/post" },
    { id: "b", url: "https://outlet-b.example/story", originatesFromUrl: "https://leaker.example/post" },
  ]);
  assert.equal(r.independentVoices, 1);
  assert.equal(r.echoedRows, 2);
  assert.equal(r.corroborationWeight, 0);
  assert.equal(r.voices[0].key, "leaker.example");
  assert.equal(r.voices[0].basis, "cited_by_others_only");
});

test("CASE 3: a manufacturer source plus an article quoting it is one voice", () => {
  const r = assessIndependence([
    { id: "vendor", url: "https://blogs.nvidia.com/blog/launch", originExamined: true },
    {
      id: "quoting",
      url: "https://tomshardware.com/news/launch",
      originatesFromUrl: "https://blogs.nvidia.com/blog/launch",
    },
  ]);
  assert.equal(r.independentVoices, 1, r.explanation);
  assert.equal(r.corroborationWeight, 0);
  const [voice] = r.voices;
  assert.equal(voice.key, "nvidia.com");
  assert.deepEqual(voice.directRowIds, ["vendor"]);
  assert.deepEqual(voice.echoRowIds, ["quoting"]);
});

test("CASE 4: multiple pages on one domain are one voice", () => {
  const r = assessIndependence([
    { id: "1", url: "https://nvidia.com/news/a", originExamined: true },
    { id: "2", url: "https://blogs.nvidia.com/blog/b", originExamined: true },
    { id: "3", url: "https://www.nvidia.com/en-gb/news/c", originExamined: true },
  ]);
  assert.equal(r.independentVoices, 1);
  assert.equal(r.sameVoiceRows, 2);
  assert.equal(r.corroborationWeight, 0);
});

test("CASE 5: genuine independent corroboration accumulates weight", () => {
  const r = assessIndependence([
    { id: "1", url: "https://nvidia.com/news/a", originExamined: true },
    { id: "2", url: "https://dpreview.com/news/b", originExamined: true },
    { id: "3", url: "https://theverge.com/news/c", originExamined: true },
  ]);
  assert.equal(r.independentVoices, 3);
  assert.equal(r.corroborationWeight, 2);
});

// ---------------------------------------------------------------------------
// The governing invariant
// ---------------------------------------------------------------------------

test("INVARIANT: adding more URLs from a voice already counted changes nothing", () => {
  const base = assessIndependence([
    { id: "1", url: "https://nvidia.com/news/a", originExamined: true },
    { id: "2", url: "https://dpreview.com/news/b", originExamined: true },
  ]);
  const inflated = assessIndependence([
    { id: "1", url: "https://nvidia.com/news/a", originExamined: true },
    { id: "2", url: "https://dpreview.com/news/b", originExamined: true },
    { id: "3", url: "https://nvidia.com/news/a?utm_campaign=x", originExamined: true },
    { id: "4", url: "https://blogs.nvidia.com/blog/also", originExamined: true },
    { id: "5", url: "https://amp.dpreview.com/news/b/amp", originExamined: true },
    { id: "6", url: "https://m.dpreview.com/news/another", originExamined: true },
  ]);
  assert.equal(inflated.corroborationWeight, base.corroborationWeight);
  assert.equal(inflated.independentVoices, base.independentVoices);
});

test("INVARIANT: ten echoes of one upstream never out-weigh one real second voice", () => {
  const echoes = assessIndependence([
    { id: "origin", url: "https://leaker.example/post", originExamined: true },
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `echo${i}`,
      url: `https://outlet-${i}.example/story`,
      originatesFromUrl: "https://leaker.example/post",
    })),
  ]);
  const twoVoices = assessIndependence([
    { id: "origin", url: "https://leaker.example/post", originExamined: true },
    { id: "other", url: "https://independent.example/own-reporting", originExamined: true },
  ]);
  assert.equal(echoes.corroborationWeight, 0);
  assert.ok(twoVoices.corroborationWeight > echoes.corroborationWeight);
});

test("an unexamined voice is worth half an examined one — unknown never counts as independent", () => {
  const examined = assessIndependence([
    { id: "1", url: "https://a.example/x", originExamined: true },
    { id: "2", url: "https://b.example/y", originExamined: true },
  ]);
  const unexamined = assessIndependence([
    { id: "1", url: "https://a.example/x" },
    { id: "2", url: "https://b.example/y" },
  ]);
  assert.equal(examined.corroborationWeight, 1);
  assert.equal(unexamined.corroborationWeight, 0.5);
  assert.equal(unexamined.unexaminedRows, 2);
});

test("rows with neither URL nor publisher are reported, not silently trusted", () => {
  const r = assessIndependence([{}, {}, {}]);
  assert.equal(r.unattributableRows, 3);
  assert.equal(r.independentVoices, 0);
  assert.equal(r.corroborationWeight, 0);
});

test("a row with no URL still resolves to a voice when it names a publisher", () => {
  const r = assessIndependence([
    { id: "1", publisher: "DPReview", originExamined: true },
    { id: "2", publisher: "dpreview ", originExamined: true },
    { id: "3", publisher: "The Verge", originExamined: true },
  ]);
  assert.equal(r.independentVoices, 2);
  assert.equal(r.sameVoiceRows, 1);
});

test("assessIndependence is order-independent", () => {
  const rows = [
    { id: "1", url: "https://nvidia.com/news/a", originExamined: true },
    { id: "2", url: "https://dpreview.com/news/b" },
    { id: "3", url: "https://outlet.example/c", originatesFromUrl: "https://nvidia.com/news/a" },
    { id: "4", url: "https://blogs.nvidia.com/blog/d", originExamined: true },
  ];
  const forward = assessIndependence(rows);
  const reversed = assessIndependence([...rows].reverse());
  assert.deepEqual(reversed, forward);
});

test("a self-citation on the same domain does not make a source derivative", () => {
  const r = assessIndependence([
    {
      id: "1",
      url: "https://dpreview.com/news/new",
      originatesFromUrl: "https://dpreview.com/news/older",
      originExamined: true,
    },
  ]);
  assert.equal(r.echoedRows, 0);
  assert.equal(r.independentVoices, 1);
  assert.equal(r.voices[0].basis, "examined_original");
});
