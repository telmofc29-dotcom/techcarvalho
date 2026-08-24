import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessCorroboration,
  classifyClaim,
  isFirstParty,
  domainsOf,
  subjectDomainsFor,
  REQUIRED_INDEPENDENT_SOURCES,
  ASSERTABILITY,
  CLAIM_CLASS_LABELS,
  FIRST_PARTY_BOUND,
  type CorroborationInput,
} from "./corroboration.ts";

function input(over: Partial<CorroborationInput> = {}): CorroborationInput {
  return {
    sourceUrls: [],
    subjectDomains: [],
    claimStatus: "reported_secondary",
    aboutUnreleasedProduct: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The real production shape: vendors announcing themselves
// ---------------------------------------------------------------------------

test("Mozilla announcing Mozilla is authoritative on one source", () => {
  // The exact live case: 'A free VPN you can trust, now built into Firefox',
  // one source, mozilla.org. Previously stuck at "low confidence".
  const v = assessCorroboration(
    input({
      sourceUrls: ["https://blog.mozilla.org/en/firefox/vpn/"],
      subjectDomains: ["mozilla.org"],
      claimStatus: "confirmed_primary",
    })
  );
  assert.equal(v.claimClass, "first_party_announcement");
  assert.equal(v.sufficient, true);
  assert.equal(v.assertability, "assertable");
  assert.deepEqual(v.missing, []);
  assert.match(v.reasons[0], /authoritative source for its own actions/i);
});

test("first-party authority is explicitly bounded on every verdict", () => {
  const v = assessCorroboration(
    input({
      sourceUrls: ["https://nvidia.com/blog/fastest-gpu-ever"],
      subjectDomains: ["nvidia.com"],
      claimStatus: "confirmed_primary",
    })
  );
  assert.equal(v.sufficient, true);
  // The bound must travel with the verdict, not live only in a doc comment.
  assert.ok(v.reasons.includes(FIRST_PARTY_BOUND));
  assert.match(FIRST_PARTY_BOUND, /not that it is/i);
});

test("an independent pickup strengthens but does not create the authority", () => {
  const v = assessCorroboration(
    input({
      sourceUrls: ["https://mozilla.org/a", "https://arstechnica.com/b"],
      subjectDomains: ["mozilla.org"],
      claimStatus: "confirmed_primary",
    })
  );
  assert.equal(v.claimClass, "first_party_announcement");
  assert.deepEqual(v.independentDomains, ["arstechnica.com"]);
  assert.match(v.reasons.join(" "), /not what makes it authoritative/i);
});

// ---------------------------------------------------------------------------
// Third-party reporting still needs two voices
// ---------------------------------------------------------------------------

test("one outlet reporting about someone else is not enough", () => {
  const v = assessCorroboration(
    input({
      sourceUrls: ["https://www.theverge.com/apple-thing"],
      subjectDomains: ["apple.com"],
      claimStatus: "reported_secondary",
    })
  );
  assert.equal(v.claimClass, "third_party_report");
  assert.equal(v.sufficient, false);
  assert.equal(v.required, 2);
  assert.match(v.missing.join(" "), /1 more independent/);
});

test("two genuinely independent outlets clear the third-party bar", () => {
  const v = assessCorroboration(
    input({
      sourceUrls: ["https://www.theverge.com/a", "https://arstechnica.com/b"],
      subjectDomains: ["apple.com"],
      claimStatus: "reported_secondary",
    })
  );
  assert.equal(v.sufficient, true);
  assert.equal(v.assertability, "attributed");
});

test("the subject's own domain never corroborates a third-party claim", () => {
  // apple.com must not count toward corroborating a claim ABOUT apple made by
  // someone else -- otherwise a vendor could self-certify third-party reporting.
  const v = assessCorroboration(
    input({
      sourceUrls: ["https://www.theverge.com/a", "https://apple.com/newsroom/b"],
      subjectDomains: ["apple.com"],
      claimStatus: "reported_secondary",
    })
  );
  // With apple.com present this becomes a first-party announcement, which is
  // the correct reclassification -- but the INDEPENDENT count still excludes it.
  assert.equal(v.independentPublishers, 1);
  assert.deepEqual(v.independentDomains, ["theverge.com"]);
});

// ---------------------------------------------------------------------------
// Unreleased products get the strictest bar
// ---------------------------------------------------------------------------

test("unreleased-product claims need three independent publishers", () => {
  const two = assessCorroboration(
    input({
      sourceUrls: ["https://www.theverge.com/a", "https://arstechnica.com/b"],
      subjectDomains: ["apple.com"],
      claimStatus: "reported_secondary",
      aboutUnreleasedProduct: true,
    })
  );
  assert.equal(two.claimClass, "unreleased_product_claim");
  assert.equal(two.required, 3);
  assert.equal(two.sufficient, false);

  const three = assessCorroboration(
    input({
      sourceUrls: [
        "https://www.theverge.com/a",
        "https://arstechnica.com/b",
        "https://www.reuters.com/c",
      ],
      subjectDomains: ["apple.com"],
      claimStatus: "reported_secondary",
      aboutUnreleasedProduct: true,
    })
  );
  assert.equal(three.sufficient, true);
  assert.equal(three.assertability, "attributed", "still never assertable as fact");
});

test("the maker announcing its own unreleased product is a first-party announcement", () => {
  // Apple announcing an iPhone before it ships is an announcement, not a
  // third-party spec claim.
  const v = assessCorroboration(
    input({
      sourceUrls: ["https://www.apple.com/newsroom/iphone"],
      subjectDomains: ["apple.com"],
      claimStatus: "confirmed_primary",
      aboutUnreleasedProduct: true,
    })
  );
  assert.equal(v.claimClass, "first_party_announcement");
  assert.equal(v.sufficient, true);
});

// ---------------------------------------------------------------------------
// Rumours never become facts
// ---------------------------------------------------------------------------

test("a rumour stays a rumour however many outlets repeat it", () => {
  const many = assessCorroboration(
    input({
      sourceUrls: [
        "https://a.com/1",
        "https://b.com/2",
        "https://c.com/3",
        "https://d.com/4",
        "https://e.com/5",
      ],
      subjectDomains: ["apple.com"],
      claimStatus: "rumour",
      aboutUnreleasedProduct: true,
    })
  );
  assert.equal(many.claimClass, "rumour_or_leak");
  assert.equal(many.assertability, "rumour_framed");
  assert.match(many.reasons.join(" "), /no number of repetitions makes it assertable/i);
  assert.match(many.reasons.join(" "), /NOT corroboration if they are repeating one original/i);
});

test("a leak sourced to the vendor's own domain is still a leak", () => {
  // First-party authority must not launder a claim a stricter rule caught.
  const v = assessCorroboration(
    input({
      sourceUrls: ["https://apple.com/leaked-page"],
      subjectDomains: ["apple.com"],
      claimStatus: "leak",
    })
  );
  assert.equal(v.claimClass, "rumour_or_leak");
  assert.notEqual(v.assertability, "assertable");
});

test("classification runs strictest-first", () => {
  // rumour beats unreleased beats first-party.
  assert.equal(
    classifyClaim(
      input({
        sourceUrls: ["https://apple.com/x"],
        subjectDomains: ["apple.com"],
        claimStatus: "rumour",
        aboutUnreleasedProduct: true,
      })
    ),
    "rumour_or_leak"
  );
});

// ---------------------------------------------------------------------------
// Domain handling
// ---------------------------------------------------------------------------

test("subdomains of the subject count as the subject", () => {
  assert.equal(
    isFirstParty(
      input({ sourceUrls: ["https://blog.mozilla.org/post"], subjectDomains: ["mozilla.org"] })
    ),
    true
  );
});

test("domains are counted by registrable domain, not by URL", () => {
  // Several pages from one publisher collapse to one domain.
  assert.equal(
    domainsOf([
      "https://www.macrumors.com/a",
      "https://macrumors.com/b",
      "https://www.macrumors.com/c?utm_source=x",
    ]).length,
    1
  );
  // Distinct publishers stay distinct.
  assert.equal(domainsOf(["https://theverge.com/a", "https://arstechnica.com/b"]).length, 2);
  // Unparseable input contributes nothing rather than a bogus domain.
  assert.deepEqual(domainsOf(["not a url"]), []);
});

test("with no subject domains recorded, nothing is treated as first-party", () => {
  // Failing OPEN here would grant self-authority to any publisher.
  const v = assessCorroboration(
    input({ sourceUrls: ["https://mozilla.org/a"], subjectDomains: [], claimStatus: "confirmed_primary" })
  );
  assert.equal(v.claimClass, "third_party_report");
  assert.equal(v.sufficient, false);
});

test("subject domains are built from recorded data, never inferred from a name", () => {
  assert.deepEqual(subjectDomainsFor({ manufacturerWebsite: "https://www.apple.com/" }), ["apple.com"]);
  assert.deepEqual(subjectDomainsFor({ manufacturerWebsite: null }), []);
  assert.deepEqual(
    subjectDomainsFor({
      manufacturerWebsite: "https://www.apple.com",
      sourceUrls: ["https://developer.apple.com/news", "https://www.apple.com/newsroom"],
    }),
    ["apple.com"]
  );
});

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

test("every claim class has a requirement, an assertability and a label", () => {
  for (const c of [
    "first_party_announcement",
    "third_party_report",
    "unreleased_product_claim",
    "rumour_or_leak",
  ] as const) {
    assert.equal(typeof REQUIRED_INDEPENDENT_SOURCES[c], "number");
    assert.ok(REQUIRED_INDEPENDENT_SOURCES[c] >= 1);
    assert.ok(ASSERTABILITY[c]);
    assert.ok(CLAIM_CLASS_LABELS[c]);
  }
});

test("only first-party announcements are ever assertable as fact", () => {
  const assertable = (
    ["first_party_announcement", "third_party_report", "unreleased_product_claim", "rumour_or_leak"] as const
  ).filter((c) => ASSERTABILITY[c] === "assertable");
  assert.deepEqual(assertable, ["first_party_announcement"]);
});

test("unreleased-product claims are the strictest class", () => {
  assert.ok(
    REQUIRED_INDEPENDENT_SOURCES.unreleased_product_claim >
      REQUIRED_INDEPENDENT_SOURCES.third_party_report
  );
});

test("every verdict explains itself", () => {
  const cases: CorroborationInput[] = [
    input({ sourceUrls: ["https://mozilla.org/a"], subjectDomains: ["mozilla.org"], claimStatus: "confirmed_primary" }),
    input({ sourceUrls: ["https://theverge.com/a"], subjectDomains: ["apple.com"] }),
    input({ sourceUrls: ["https://theverge.com/a"], subjectDomains: ["apple.com"], aboutUnreleasedProduct: true }),
    input({ sourceUrls: ["https://x.com/a"], subjectDomains: ["apple.com"], claimStatus: "rumour" }),
  ];
  for (const c of cases) {
    const v = assessCorroboration(c);
    assert.ok(v.reasons.length > 0, `${v.claimClass} gave no reason`);
    assert.ok(v.reasons.every((r) => r.length > 20));
    if (!v.sufficient) assert.ok(v.missing.length > 0, `${v.claimClass} insufficient but named nothing missing`);
  }
});
