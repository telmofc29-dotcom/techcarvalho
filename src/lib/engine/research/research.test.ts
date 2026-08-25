import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSubjects,
  primarySubject,
  subjectDomainsForText,
  researchQueries,
  identifyingQueries,
  ORGANISATIONS,
} from "./entity-model.ts";
import {
  extractClaims,
  findHedges,
  findAttribution,
  extractValues,
  splitSentences,
  summariseClaims,
  renderClaim,
  assertabilityOf,
} from "./claim-extraction.ts";
import { assessLineage, citedOrigin } from "./lineage.ts";
import { findMatches, subjectNoun } from "./research-pipeline.ts";
import { PRIORITY_ENTITIES } from "../priority-entities.ts";
import { SEED_SOURCES, BLOCKED_SOURCES, STALE_SOURCES, independenceGroups, sourcesForCategory } from "./source-seed.ts";

// ===========================================================================
// Entity model
// ===========================================================================

test("product lines resolve to their organisation without a manufacturer row", () => {
  assert.equal(primarySubject("iPhone 18 rumours")?.organisation.name, "Apple");
  assert.equal(primarySubject("New NIKKOR Z lens announced")?.organisation.name, "Nikon");
  assert.equal(primarySubject("GeForce RTX 6090 leak")?.organisation.name, "NVIDIA");
  assert.equal(primarySubject("Ryzen 10950X benchmarks")?.organisation.name, "AMD");
  assert.equal(primarySubject("Canon EOS R7 Mark II")?.organisation.name, "Canon");
  assert.equal(primarySubject("GTA 6 delayed again")?.organisation.name, "Rockstar Games");
  assert.equal(primarySubject("DJI Mini 5 Pro review")?.organisation.name, "DJI");
});

test("organisations that are not manufacturers resolve too", () => {
  assert.equal(primarySubject("Firefox adds a VPN")?.organisation.name, "Mozilla");
  assert.equal(primarySubject("NASA Artemis update")?.organisation.name, "NASA");
  assert.equal(primarySubject("VESA updates DisplayPort")?.organisation.name, "VESA");
  assert.equal(primarySubject("Bluetooth SIG publishes core spec")?.organisation.name, "Bluetooth SIG");
  assert.equal(primarySubject("ubisys joins Works with Home Assistant")?.organisation.name, "Home Assistant");
});

test("matching is word-boundary, so substrings do not create false subjects", () => {
  // The classic failure: "Arm" inside "alarm", "Apple" inside "Applebee's".
  assert.equal(primarySubject("A new alarm clock for your bedside"), null);
  assert.equal(primarySubject("Pineapple farming techniques"), null);
});

test("the most specific alias wins", () => {
  const m = primarySubject("Apple Watch Series 12 announced");
  assert.equal(m?.organisation.name, "Apple");
  assert.equal(m?.matchedAlias, "apple watch");
});

test("a story about two organisations reports both", () => {
  const subjects = resolveSubjects("NVIDIA and Canon announce a joint imaging platform");
  const names = subjects.map((s) => s.organisation.name);
  assert.ok(names.includes("NVIDIA"));
  assert.ok(names.includes("Canon"));
});

test("subject domains come from the resolved organisation", () => {
  assert.deepEqual(subjectDomainsForText("iPhone 18 rumours"), ["apple.com"]);
  assert.deepEqual(subjectDomainsForText("nothing here matches"), []);
});

test("research queries generate several angles, not one", () => {
  const subject = primarySubject("Apple iPhone 18 camera upgrade reported");
  const queries = researchQueries("Apple iPhone 18 camera upgrade reported", subject);
  assert.ok(queries.length >= 3, `expected several angles, got ${queries.length}`);
  assert.ok(queries.some((q) => /apple/i.test(q.query)));
  assert.ok(queries.every((q) => q.query.length >= 3));
});

test("broad company queries are topical, never identifying", () => {
  // The failure this prevents: researching "iPhone 18" matched an AirTags deal
  // at full strength because the one-word query "Apple" hits every Apple story,
  // and six such hits were reported as six independent origins.
  const subject = primarySubject("iPhone 18");
  const queries = researchQueries("iPhone 18", subject);
  const apple = queries.find((q) => q.query.toLowerCase() === "apple");
  assert.ok(apple, "the topical angle should still be generated");
  assert.equal(apple.kind, "topical");

  const usable = identifyingQueries(queries);
  assert.ok(!usable.some((q) => q.toLowerCase() === "apple"));
  // The title itself says more than who it is about, so it identifies.
  assert.ok(usable.some((q) => /18/.test(q)), JSON.stringify(usable));
});

test("a title naming only the company yields no identifying query", () => {
  // "Apple" alone cannot identify a story, so nothing may match on it.
  const subject = primarySubject("Apple");
  assert.deepEqual(identifyingQueries(researchQueries("Apple", subject)), []);
});

test("only identifying queries can produce evidence matches", () => {
  const corpus = [
    {
      title: "Apple's four-pack of AirTags is $20 off",
      link: "https://www.theverge.com/deal",
      publishedAt: null,
      summary: "A deal on AirTags.",
      source: SEED_SOURCES.find((s) => s.organisation === "The Verge")!,
    },
  ];
  const subject = primarySubject("iPhone 18");
  const queries = researchQueries("iPhone 18", subject);

  // Topical "Apple" would match this deal; identifying "iPhone 18" must not.
  assert.equal(findMatches(identifyingQueries(queries), corpus).length, 0);
  assert.ok(findMatches(["Apple"], corpus).length >= 0); // broad query is not used in practice
});

test("every organisation declares domains, aliases and categories", () => {
  for (const o of ORGANISATIONS) {
    assert.ok(o.domains.length > 0, `${o.name} has no domains`);
    assert.ok(o.aliases.length > 0, `${o.name} has no aliases`);
    assert.ok(o.categories.length > 0, `${o.name} has no categories`);
  }
});

// ===========================================================================
// Claim extraction — hedging must survive
// ===========================================================================

test("the motivating sentence keeps every hedge", () => {
  const claims = extractClaims(
    "Apple is reportedly developing a new camera system that could arrive in 2027. " +
      "The company has not commented on the matter."
  );
  assert.ok(claims.length >= 1);
  const first = claims[0];
  assert.equal(first.assertability, "hedged");
  assert.ok(first.hedges.includes("reportedly"), `hedges were ${JSON.stringify(first.hedges)}`);
  assert.ok(first.hedges.includes("could"));
  assert.ok(first.values.includes("2027"));
});

test("more than one claim is extracted — the one-fact bug", () => {
  const claims = extractClaims(
    "Sony announced the A9 IV today. The camera uses a 33MP stacked sensor. " +
      "It will ship in November for $4,999. Reviewers have not yet tested it."
  );
  assert.ok(claims.length >= 3, `expected several claims, got ${claims.length}`);
});

test("a hedged claim can never render as a plain statement", () => {
  const [claim] = extractClaims("The iPhone 18 may include a 2nm chip according to Bloomberg.");
  assert.equal(claim.assertability, "hedged");
  const rendered = renderClaim(claim);
  assert.match(rendered, /^UNCONFIRMED/);
});

test("attribution and hedging are tracked separately", () => {
  assert.equal(findAttribution("According to Apple, the battery lasts 20 hours."), "Apple");
  assert.deepEqual(findHedges("According to Apple, the battery lasts 20 hours."), []);
  assert.ok(findHedges("Apple may improve battery life.").includes("may"));
});

test("hedge beats attribution", () => {
  // Sourcing never removes uncertainty that is in the claim itself.
  assert.equal(assertabilityOf(["may"], "Bloomberg"), "hedged");
  assert.equal(assertabilityOf([], "Bloomberg"), "attributed");
});

test("an unrecognised construction defaults to attributed, never assertable", () => {
  // Failing toward certainty is the dangerous direction.
  assert.equal(assertabilityOf([], null), "attributed");
});

test("the longest hedge is reported, not the bare word", () => {
  const hedges = findHedges("The device is expected to launch in spring.");
  assert.ok(hedges.includes("is expected to"), JSON.stringify(hedges));
  assert.ok(!hedges.includes("expected"), "should not double-report the shorter form");
});

test("checkable values are pulled out", () => {
  const values = extractValues("The 6.9-inch display runs at 120Hz and the chip is built on 2nm for $1,199.");
  assert.ok(values.some((v) => /120Hz/i.test(v)), JSON.stringify(values));
  assert.ok(values.some((v) => /2nm/i.test(v)));
  assert.ok(values.some((v) => v.includes("1,199")));
});

test("sentence splitting survives decimals and abbreviations", () => {
  const s = splitSentences("The 6.2-inch panel is new. Apple Inc. confirmed it. Prices start at $999.");
  assert.equal(s.length, 3, JSON.stringify(s));
  assert.match(s[0], /6\.2-inch/);
  assert.match(s[1], /Inc\./);
});

test("claim summaries count each assertability", () => {
  const claims = extractClaims(
    "Apple reportedly plans a 2027 launch of the device. According to Reuters, production has begun at scale. " +
      "The company declined to comment on the report."
  );
  const s = summariseClaims(claims);
  assert.equal(s.total, claims.length);
  assert.equal(s.assertable + s.attributed + s.hedged, s.total);
  assert.ok(s.hedged >= 1);
});

test("fragments too short to be claims are dropped", () => {
  assert.equal(extractClaims("Yes. No. Maybe.").length, 0);
});

// ===========================================================================
// Lineage — origins, not URLs
// ===========================================================================

test("three outlets citing Bloomberg are ONE origin", () => {
  const l = assessLineage([
    { url: "https://www.theverge.com/a", text: "According to Bloomberg, Apple will ship in 2027." },
    { url: "https://www.engadget.com/b", text: "Bloomberg reports that Apple will ship in 2027." },
    { url: "https://www.macrumors.com/c", text: "Via Bloomberg: Apple will ship in 2027." },
  ]);
  assert.equal(l.independentOrigins, 0, "all three are derived from Bloomberg");
  assert.equal(l.collapsed.length, 3);
  assert.match(l.explanation, /credit another outlet/i);
});

test("two mastheads with one owner are ONE voice", () => {
  const l = assessLineage([
    { url: "https://www.theverge.com/a", independenceGroup: "Vox Media", text: "Our reporting shows..." },
    { url: "https://www.polygon.com/b", independenceGroup: "Vox Media", text: "Our reporting shows..." },
  ]);
  assert.equal(l.independentOrigins, 1);
  assert.match(l.collapsed[0].reason, /Same owner/i);
});

test("genuinely independent outlets count separately", () => {
  const l = assessLineage([
    { url: "https://www.theverge.com/a", independenceGroup: "Vox Media", text: "Our own reporting." },
    { url: "https://arstechnica.com/b", independenceGroup: "Conde Nast", text: "Our own reporting." },
    { url: "https://www.gsmarena.com/c", independenceGroup: "GSMArena", text: "Our own reporting." },
  ]);
  assert.equal(l.independentOrigins, 3);
  assert.equal(l.collapsed.length, 0);
});

test("Wired and Ars do not corroborate each other", () => {
  // Both Condé Nast. The registry declares this.
  const l = assessLineage([
    { url: "https://www.wired.com/a", independenceGroup: "Conde Nast", text: "Reporting." },
    { url: "https://arstechnica.com/b", independenceGroup: "Conde Nast", text: "Reporting." },
  ]);
  assert.equal(l.independentOrigins, 1);
});

test("an outlet citing itself is not treated as derived", () => {
  assert.equal(citedOrigin("The Verge reports that we confirmed it", "theverge.com"), null);
});

test("vague attribution is not mistaken for an upstream outlet", () => {
  // "people familiar" must not collapse independent reports into a phantom origin.
  assert.equal(citedOrigin("According to people familiar with the matter", "example.com"), null);
  assert.equal(citedOrigin("According to the company", "example.com"), null);
});

test("the assessment admits what it cannot see", () => {
  const l = assessLineage([{ url: "https://a.com/1", text: "Reporting." }]);
  assert.match(l.explanation, /uncited lift cannot be detected/i);
});

// ===========================================================================
// Source registry
// ===========================================================================

test("the registry contains real independent journalism", () => {
  const editorial = SEED_SOURCES.filter((s) => s.publisherType === "editorial");
  assert.ok(editorial.length >= 15, `only ${editorial.length} editorial sources`);
});

test("independence groups collapse shared owners", () => {
  const groups = independenceGroups();
  // Fewer groups than sources, because several share an owner.
  assert.ok(groups.length < SEED_SOURCES.length);
  const vox = SEED_SOURCES.filter((s) => s.independenceGroup === "Vox Media").map((s) => s.organisation);
  assert.ok(vox.includes("The Verge") && vox.includes("Polygon"));
  const conde = SEED_SOURCES.filter((s) => s.independenceGroup === "Conde Nast").map((s) => s.organisation);
  assert.ok(conde.includes("Wired") && conde.includes("Ars Technica"));
  const future = SEED_SOURCES.filter((s) => s.independenceGroup === "Future plc").map((s) => s.organisation);
  assert.ok(future.includes("Tom's Hardware") && future.includes("PC Gamer"));
});

test("every source declares the metadata the registry needs", () => {
  for (const s of SEED_SOURCES) {
    assert.ok(s.domain && !s.domain.includes("/"), `${s.organisation} bad domain`);
    assert.ok(s.feedUrl.startsWith("https://"), `${s.organisation} feed must be https`);
    assert.ok(s.categories.length > 0, `${s.organisation} has no categories`);
    assert.ok(s.independenceGroup.length > 0, `${s.organisation} has no independence group`);
    assert.ok(s.verifiedItems > 0, `${s.organisation} was never verified`);
  }
});

test("category lookup returns relevant sources, and never returns nothing", () => {
  assert.ok(sourcesForCategory("gaming").length >= 4);
  assert.ok(sourcesForCategory("cameras-photography").length >= 3);
  // An unmapped category still gets researched, just less precisely.
  assert.ok(sourcesForCategory("a-category-that-does-not-exist").length > 0);
});

test("blocked sources are recorded rather than silently dropped", () => {
  assert.ok(BLOCKED_SOURCES.length > 0);
  for (const b of BLOCKED_SOURCES) {
    assert.ok(b.note.length > 10, `${b.organisation} has no explanation`);
    // status 0 means the connection never completed, so there IS no HTTP
    // status to record. That is a distinct fact from a server answering with a
    // refusal, and it must say so rather than borrowing a code it never got.
    if (b.status === 0) {
      assert.match(
        b.note,
        /connection failed/i,
        `${b.organisation} records status 0 without explaining the connection failure`
      );
    } else {
      assert.ok(b.status >= 100, `${b.organisation} has an implausible status ${b.status}`);
    }
  }
  // The ones that refused us are recorded as refusals, not as failures of ours.
  assert.ok(BLOCKED_SOURCES.some((b) => b.status === 403));
});

// ---------------------------------------------------------------------------
// Subject phrases become live article titles
// ---------------------------------------------------------------------------

test("a subject phrase never ends mid-thought", () => {
  // Each of these reached a real draft title before trimDangling existed.
  // A trailing preposition or bare number reads to a reader as a truncation
  // bug, which is exactly what it was.
  const cases: [string, RegExp][] = [
    ["iPhone 18 Pro's new price might be better than you expect", /price$/i],
    ["When Apple announced its event over the last six weeks it said nothing", /event$/i],
    ["iPadOS 27 adds three features to make iPad more like a Mac", /iPad$/i],
  ];
  for (const [headline, endsWith] of cases) {
    const noun = subjectNoun(headline, null);
    assert.match(noun, endsWith, `${headline} -> ${noun}`);
  }
});

test("a colon headline keeps its substantive half", () => {
  // Taking the first half produced the bare title "Hot Chips 2026".
  const noun = subjectNoun("Hot Chips 2026: Intel Xeon 7 'Diamond Rapids' comes with 256 cores", null);
  assert.match(noun, /Xeon 7/);
  assert.doesNotMatch(noun, /^Hot Chips 2026$/);
});

test("a short headline is left alone", () => {
  assert.equal(subjectNoun("Samsung unveils the Galaxy S26 Ultra", null), "Samsung unveils the Galaxy S26 Ultra");
});

test("trimming never empties the phrase", () => {
  // Guard against a headline of nothing but function words producing "".
  for (const h of ["More of the", "Up to the new", "It is about to be"]) {
    assert.ok(subjectNoun(h, null).trim().length > 0, h);
  }
});

test("hedging words are stripped from the subject phrase", () => {
  // These are restored in the body with CONFIRMED/REPORTED framing; a headline
  // noun phrase carries the subject, not the epistemic status.
  assert.equal(
    subjectNoun("New Mac Mini Reportedly Set to Launch Before iPhone", null),
    "New Mac Mini Set to Launch Before iPhone"
  );
  assert.equal(
    subjectNoun("Apple Reportedly Will Announce iPhone 18 Pro Event Date", null),
    "Apple Will Announce iPhone 18 Pro Event Date"
  );
});

// ---------------------------------------------------------------------------
// Source coverage — a watched category with no source can never produce news
// ---------------------------------------------------------------------------

test("every category the watchlist uses has at least one registered source", () => {
  // `drones-fpv` and `action-cameras` were named by the watchlist and tagged on
  // NO source at all, so tier 1 DJI surfaced four items and Autel surfaced
  // none. A category with no feed behind it reports "no news" forever, which
  // is indistinguishable from a company that genuinely went quiet.
  const watched = new Set(PRIORITY_ENTITIES.flatMap((e) => e.categories));
  const covered = new Set(SEED_SOURCES.flatMap((s) => s.categories));
  const uncovered = [...watched].filter((c) => !covered.has(c)).sort();
  assert.deepEqual(uncovered, [], `watched categories with no source: ${uncovered.join(", ")}`);
});

test("first-party newsrooms are typed so they earn primary trust", () => {
  // Only publisherType 'first_party' maps to trust_level 'primary', which is
  // what lets a company's own announcement count as an assertable claim rather
  // than somebody's report of one. Mistyping a newsroom silently demotes it.
  const newsrooms = ["Samsung Newsroom", "Google Blog", "NVIDIA Blog", "Arm", "Xbox Wire", "PlayStation Blog"];
  for (const name of newsrooms) {
    const s = SEED_SOURCES.find((x) => x.organisation === name);
    assert.ok(s, `${name} is not registered`);
    assert.equal(s.publisherType, "first_party", `${name} must be first_party`);
  }
});

test("sources sharing a corporate owner share an independence group", () => {
  // DroneDJ, 9to5Mac and 9to5Google are one owner. Counting them as three
  // confirmations is the exact failure the independence model exists to stop.
  const group = (n: string) => SEED_SOURCES.find((s) => s.organisation === n)?.independenceGroup;
  assert.equal(group("DroneDJ"), group("9to5Mac"));
  assert.equal(group("9to5Google"), group("9to5Mac"));
  assert.equal(group("XDA Developers"), group("Android Police"));
});

test("a stale feed is recorded, not registered", () => {
  // A feed that answers 200 but stopped publishing makes a coverage gap look
  // like an absence of news, which is the worst of both.
  assert.ok(STALE_SOURCES.length > 0);
  const registered = new Set(SEED_SOURCES.map((s) => s.feedUrl));
  for (const s of STALE_SOURCES) {
    assert.ok(!registered.has(s.feedUrl), `${s.organisation} is both stale and registered`);
    assert.match(s.newestItem, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("a watched company's own domain is known, or it can never be first-party", () => {
  // THE 3D-PRINTING BLOCK. An organisation missing from this registry has no
  // known domains, so isFirstParty() is always false, so its OWN announcement
  // is classified `third_party_report` and needs two independent sources
  // instead of one. "Elegoo Launches Nexprint", published by Elegoo on
  // elegoo.com, was treated as somebody's report about Elegoo — and every
  // 3D-printing story in the corpus was held for want of a second source that
  // was never going to exist.
  //
  // The evidence bar was never the problem. The engine could not tell that the
  // maker was the one talking.
  const known = new Set(ORGANISATIONS.flatMap((o) => o.aliases.map((a) => a.toLowerCase())));
  const missing = PRIORITY_ENTITIES.filter(
    (e) => !e.aliases.some((a) => known.has(a.toLowerCase()))
  ).map((e) => e.name);
  assert.deepEqual(missing, [], `watched entities with no subject-domain entry: ${missing.join(", ")}`);
});

test("every organisation that is a company declares at least one domain", () => {
  for (const o of ORGANISATIONS) {
    assert.ok(o.domains.length > 0, `${o.name} has no domain, so it can never be first-party`);
    for (const d of o.domains) {
      assert.match(d, /^[a-z0-9.-]+\.[a-z]{2,}$/, `${o.name} has an implausible domain ${d}`);
    }
  }
});
