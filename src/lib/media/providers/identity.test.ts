// Identity tests: expansion must widen the search without widening the subject.
//
// The two named failures from the brief, kept as executable assertions:
//   * under-expansion — one literal search per product reported ZERO Commons
//     files for three products that had good CC BY-SA 4.0 photography, because
//     the files were titled "GoPro Héro 13 Black" (French, accented) under a
//     lowercase category and described in Polish;
//   * over-expansion — Canon EOS 60D is not another Canon DSLR, RTX 5090 is not
//     a generic GPU, PS5 Pro is not PS5, Switch 2 is not Switch.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  identityTokens,
  discriminators,
  spellingVariants,
  assertIdentityPreserved,
  expandQueries,
  matchCategoryTitle,
  isCapturingDeviceCategory,
  type SubjectIdentity,
} from "./query-expansion.ts";
import { assessEntityMatch } from "./entity-match.ts";
import {
  licenceFromWikitext,
  informationField,
  meaningfulPermission,
  exifRightsConflict,
  stripHtml,
  firstHref,
} from "./wikimedia-commons.ts";

const gopro: SubjectIdentity = {
  canonicalName: "GoPro HERO13 Black", manufacturer: "GoPro", aliases: ["GoPro Hero 13 Black"], family: "GoPro HERO",
};
const eos60d: SubjectIdentity = {
  canonicalName: "Canon EOS 60D", manufacturer: "Canon", aliases: [], family: "Canon EOS",
};
const ps5pro: SubjectIdentity = {
  canonicalName: "Sony PlayStation 5 Pro", manufacturer: "Sony", aliases: ["PS5 Pro"], family: "PlayStation 5",
};
const rtx5090: SubjectIdentity = {
  canonicalName: "NVIDIA GeForce RTX 5090", manufacturer: "NVIDIA", aliases: ["RTX 5090"], family: "GeForce RTX 50",
};

describe("token folding", () => {
  test("accents, case and letter/digit runs all fold to the same tokens", () => {
    const a = identityTokens("GoPro Héro 13 Black");
    const b = identityTokens("GOPRO HERO13 BLACK");
    const c = identityTokens("gopro-hero-13-black");
    assert.deepEqual(a, b);
    assert.deepEqual(b, c);
    assert.deepEqual(a, ["gopro", "hero", "13", "black"]);
  });

  test("discriminators are the model numbers and variant words, never the brand", () => {
    assert.ok(discriminators("Canon EOS 60D").includes("60"));
    assert.ok(!discriminators("Canon EOS 60D").includes("canon"));
    assert.ok(discriminators("Sony PlayStation 5 Pro").includes("5"));
    assert.ok(discriminators("Sony PlayStation 5 Pro").includes("pro"));
    assert.ok(discriminators("NVIDIA GeForce RTX 5090").includes("5090"));
  });
});

describe("identity preservation", () => {
  test("a query that drops the model number is refused", () => {
    const check = assertIdentityPreserved("Canon EOS", eos60d);
    assert.equal(check.preserved, false);
    if (!check.preserved) assert.ok(check.missing.includes("60"));
  });

  test("PS5 Pro must not reduce to PS5", () => {
    const check = assertIdentityPreserved("PlayStation 5", ps5pro);
    assert.equal(check.preserved, false);
    if (!check.preserved) assert.ok(check.missing.includes("pro"));
  });

  test("a spelling variant preserves identity", () => {
    for (const v of spellingVariants("GoPro HERO13 Black")) {
      assert.equal(assertIdentityPreserved(v, gopro).preserved, true, `variant "${v}" lost identity`);
    }
  });

  test("a name with no derivable discriminator fails closed rather than searching broadly", () => {
    const vague: SubjectIdentity = { canonicalName: "Wireless Router", manufacturer: "TP-Link", aliases: [], family: null };
    const check = assertIdentityPreserved("TP-Link Wireless Router", vague);
    assert.equal(check.preserved, false);
    assert.match(check.preserved ? "" : check.reason, /reduces to brand and category words|No discriminating token/);
  });
});

describe("query expansion", () => {
  test("category enumeration comes first, free text last", () => {
    const plan = expandQueries(gopro);
    assert.equal(plan.strict[0].strategy, "category_lookup");
    assert.equal(plan.strict[plan.strict.length - 1].strategy, "text_search");
  });

  test("several sensible queries are generated, not one literal search", () => {
    const plan = expandQueries(eos60d);
    assert.ok(plan.strict.length >= 5, `expected multiple expansions, got ${plan.strict.length}`);
    const strategies = new Set(plan.strict.map((q) => q.strategy));
    assert.ok(strategies.has("category_lookup"));
    assert.ok(strategies.has("intitle_search"));
    assert.ok(strategies.has("insource_search"));
  });

  test("every strict query still names the exact product", () => {
    for (const identity of [gopro, eos60d, ps5pro, rtx5090]) {
      for (const q of expandQueries(identity).strict) {
        assert.equal(
          assertIdentityPreserved(q.value, identity).preserved,
          true,
          `"${q.value}" lost the identity of ${identity.canonicalName}`
        );
      }
    }
  });

  test("the manufacturer-only shortcut is generated and explicitly refused", () => {
    const plan = expandQueries(eos60d);
    const refused = plan.rejected.find((r) => r.value === "Canon");
    assert.ok(refused, "the engine should record that it considered and declined a brand-only search");
    assert.match(refused!.reason, /never as a source of accepted candidates/);
  });

  test("broad queries exist for tree-walking but carry no identity guarantee", () => {
    const plan = expandQueries(gopro);
    assert.ok(plan.broad.length > 0, "without a manufacturer tree walk the lowercase GoPro category is unreachable");
    for (const q of plan.broad) assert.deepEqual(q.identityTokens, []);
  });
});

describe("category matching", () => {
  test("the real lowercase, differently-spelled GoPro category is accepted", () => {
    const m = matchCategoryTitle("Category:GoPro Hero 13 black", gopro);
    assert.equal(m.accepted, true, m.reason);
  });

  test("a capturing-device category is refused", () => {
    assert.equal(isCapturingDeviceCategory("Category:Taken with GoPro HERO13 Black"), true);
    assert.equal(isCapturingDeviceCategory("Category:Photographs taken with Nikon D750"), true);
    // The DJI trap: an opaque EXIF model code that looks like a product category.
    assert.equal(isCapturingDeviceCategory("Category:DJI FC8482"), true);
    assert.equal(isCapturingDeviceCategory("Category:GoPro Hero 13 black"), false);

    const m = matchCategoryTitle("Category:Taken with GoPro HERO13 Black", gopro);
    assert.equal(m.accepted, false);
    assert.match(m.reason, /TAKEN WITH/);
  });

  test("a sibling-generation category is refused, not scored down", () => {
    assert.equal(matchCategoryTitle("Category:GoPro Hero 12 black", gopro).accepted, false);
    assert.equal(matchCategoryTitle("Category:GoPro Hero", gopro).accepted, false);
    assert.equal(matchCategoryTitle("Category:Canon EOS 70D", eos60d).accepted, false);
    assert.equal(matchCategoryTitle("Category:PlayStation 5", ps5pro).accepted, false);
  });

  test("a category carrying a foreign variant token is refused as ambiguous", () => {
    const m = matchCategoryTitle("Category:GoPro Hero 13 black Mini", gopro);
    assert.equal(m.accepted, false);
    assert.match(m.reason, /Ambiguous|foreign/i);
  });
});

describe("entity match on real-shaped descriptors", () => {
  test("a Polish-described file in the right category still confirms", () => {
    const dji: SubjectIdentity = { canonicalName: "DJI Mini 4 Pro", manufacturer: "DJI", aliases: [], family: "DJI Mini" };
    const m = assessEntityMatch(dji, {
      title: "File:2024 Dron DJI Mini 4 Pro (03).jpg",
      fileName: "2024 Dron DJI Mini 4 Pro (03).jpg",
      categories: ["Category:DJI Mini 4 Pro"],
      descriptionText: "Dron DJI Mini 4 Pro na białym tle",
      mimeType: "image/jpeg",
    });
    assert.equal(m.verdict, "confirmed", m.reason);
  });

  test("a logo SVG matching the product name does not confirm", () => {
    const galaxy: SubjectIdentity = {
      canonicalName: "Samsung Galaxy S26 Ultra", manufacturer: "Samsung", aliases: [], family: "Galaxy S",
    };
    const m = assessEntityMatch(galaxy, {
      title: "File:Samsung logo.svg",
      fileName: "Samsung logo.svg",
      categories: ["Category:Samsung logos"],
      descriptionText: "Samsung wordmark",
      mimeType: "image/svg+xml",
    });
    assert.notEqual(m.verdict, "confirmed");
  });

  test("a photo taken WITH the subject camera is not a photo OF it", () => {
    const m = assessEntityMatch(gopro, {
      title: "File:Rue de Dijon GoPro HERO13 Black 2025.jpg",
      fileName: "Rue de Dijon GoPro HERO13 Black 2025.jpg",
      categories: ["Category:Taken with GoPro HERO13 Black"],
      descriptionText: "Street level imagery",
      mimeType: "image/jpeg",
      exifCameraModel: "HERO13 Black",
    });
    assert.notEqual(m.verdict, "confirmed");
  });

  test("a filename that says 'taken with' is rejected outright, not scored down", () => {
    // Verbatim shape of 32 files a real Commons search returned for this product.
    const m = assessEntityMatch(gopro, {
      title: "File:Mapillary (startless) 2025-07-31 19H49M54S000 (563935103408663 at VQ915EJ02Mujv4eGTOswap) taken with GoPro HERO13 Black.jpg",
      fileName: "Mapillary (startless) 2025-07-31 taken with GoPro HERO13 Black.jpg",
      categories: [],
      descriptionText: null,
      mimeType: "image/jpeg",
    });
    assert.equal(m.verdict, "rejected");
    assert.equal(m.confidence, 0);
    assert.match(m.reason, /taken by a camera is not a photograph of it/i);
  });

  test("a frame lifted from a review video is not product photography", () => {
    // Verbatim titles from a real Commons search for the RTX 5080.
    const rtx: SubjectIdentity = {
      canonicalName: "NVIDIA GeForce RTX 5080", manufacturer: "NVIDIA", aliases: ["RTX 5080"], family: "GeForce RTX 50",
    };
    for (const title of [
      "File:RTX 5080 FE首发评测：赛博工艺品 (2160p 60fps VP9-128kbit AAC)-00.01.24.019.png",
      "File:B-Rolls der NVIDIA GeForce RTX 5080 (by Geekerwan).webm",
    ]) {
      const m = assessEntityMatch(rtx, {
        title, fileName: title.replace(/^File:/, ""), categories: [], descriptionText: null, mimeType: "image/png",
      });
      assert.notEqual(m.verdict, "confirmed", title);
    }
  });

  test("a bare PCB naming two different cards is not a photograph of either", () => {
    const rtx: SubjectIdentity = {
      canonicalName: "NVIDIA GeForce RTX 5080", manufacturer: "NVIDIA", aliases: ["RTX 5080"], family: "GeForce RTX 50",
    };
    const m = assessEntityMatch(rtx, {
      title: "File:Nvidia RTX 5080 5090 FE PCB.png",
      fileName: "Nvidia RTX 5080 5090 FE PCB.png",
      categories: ["Category:GeForce RTX 5080"],
      descriptionText: null,
      mimeType: "image/png",
    });
    assert.notEqual(m.verdict, "confirmed", m.reason);
  });

  test("a die micrograph is not the retail processor", () => {
    const intel: SubjectIdentity = {
      canonicalName: "Intel Core Ultra 9 285K", manufacturer: "Intel", aliases: [], family: "Core Ultra",
    };
    const m = assessEntityMatch(intel, {
      title: "File:Intel Core Ultra 9 285K die micrograph.jpg",
      fileName: "Intel Core Ultra 9 285K die micrograph.jpg",
      categories: [],
      descriptionText: "Delidded die micrograph of the Intel Core Ultra 9 285K",
      mimeType: "image/jpeg",
    });
    assert.notEqual(m.verdict, "confirmed", "bare silicon is not a photograph of the retail product");
  });
});

describe("Commons evidence parsing", () => {
  test("the licence template is read from raw wikitext, not a rendered badge", () => {
    assert.equal(licenceFromWikitext("{{self|cc-by-sa-4.0}}").licence, "CC BY-SA 4.0");
    assert.equal(licenceFromWikitext("== Licensing ==\n{{Cc-by-sa-3.0}}\n").licence, "CC BY-SA 3.0");
    assert.equal(licenceFromWikitext("{{PD-self}}").licence, "Public domain");
    assert.equal(licenceFromWikitext("{{Cc-zero}}").licence, "CC0");
    assert.equal(licenceFromWikitext("no template here").licence, null);
  });

  test("multi-version and all-versions licence tags are read", () => {
    // A `[|}]`-only terminator misses the comma form entirely.
    assert.equal(licenceFromWikitext("{{Cc-by-sa-4.0,3.0,2.5,2.0,1.0}}").licence, "CC BY-SA 4.0");
    assert.equal(licenceFromWikitext("{{self|GFDL|cc-by-sa-all}}").licence, "CC BY-SA 4.0");
    assert.equal(licenceFromWikitext("{{self|cc-zero}}").licence, "CC0");
    assert.equal(licenceFromWikitext("{{PD-textlogo}}").licence, "Public domain");
  });

  test("a prohibitive template wins over a permissive one on the same page", () => {
    const both = "{{self|cc-by-sa-4.0}}\n{{cc-by-nc-4.0}}";
    assert.equal(licenceFromWikitext(both).licence, "CC BY-NC (NonCommercial)");
  });

  test("Information fields are extracted", () => {
    const wt = "{{Information\n|description=A camera\n|source={{own}}\n|author=[[User:Someone]]\n|permission=\n}}";
    assert.equal(informationField(wt, "source"), "{{own}}");
    assert.equal(informationField(wt, "author"), "[[User:Someone]]");
    assert.equal(meaningfulPermission(informationField(wt, "permission")), null);
  });

  test("a field name containing a space does not bleed into the previous field", () => {
    // The real regression: `|other versions=` was captured as the value of
    // `permission=`, which made four correctly-licensed GoPro photographs look
    // like they carried a rights condition.
    const wt =
      "{{Information\n|description={{fr|1=Caméra GoPro}}\n|date=2024-10-01\n|source={{own}}\n" +
      "|author=[[User:François de Dijon|François Leblond]]\n|permission=\n|other versions=\n}}";
    assert.equal(informationField(wt, "permission"), null);
    assert.equal(meaningfulPermission(informationField(wt, "permission")), null);
    assert.equal(informationField(wt, "source"), "{{own}}");
    assert.equal(informationField(wt, "date"), "2024-10-01");
  });

  test("a genuinely populated permission field is still captured", () => {
    const wt = "{{Information\n|permission=VRT ticket #2024010110000123\n|other versions=\n}}";
    assert.equal(meaningfulPermission(informationField(wt, "permission")), "VRT ticket #2024010110000123");
  });

  test("a multi-line field value is captured whole", () => {
    const wt = "{{Information\n|description=Line one\ncontinued on line two\n|source={{own}}\n}}";
    assert.equal(informationField(wt, "description"), "Line one continued on line two");
  });

  test("an empty permission field is normal; a populated one is a flag", () => {
    assert.equal(meaningfulPermission(""), null);
    assert.equal(meaningfulPermission("see below"), null);
    assert.equal(meaningfulPermission("own work"), null);
    assert.ok(meaningfulPermission("VRT ticket 2024010110000123"));
  });

  test("EXIF conflict detection distinguishes a reservation from an authorship line", () => {
    // The Canon EOS 5D rejection.
    assert.ok(exifRightsConflict("All rights reserved"));
    assert.ok(exifRightsConflict("(c) 2024 Someone. Do not copy."));
    // The GoPro near-miss: CC does not waive copyright, so naming the author is
    // exactly what a correctly-licensed file looks like.
    assert.equal(exifRightsConflict("Francois Leblond"), null);
    assert.equal(exifRightsConflict(null), null);
  });

  test("HTML author fields are stripped and their user page recovered", () => {
    const html = '<a href="//commons.wikimedia.org/wiki/User:Jacek_Halicki" title="User:Jacek Halicki">Jacek Halicki</a>';
    assert.equal(stripHtml(html), "Jacek Halicki");
    assert.equal(firstHref(html), "https://commons.wikimedia.org/wiki/User:Jacek_Halicki");
  });
});
