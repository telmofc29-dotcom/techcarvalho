// EVERGREEN 3D-PRINTING BRIEFS, from verified first-party documentation.
//
// WHY BRIEFS AND NOT DRAFTS
// -------------------------
// The news pipeline cannot produce evergreen material. A guide, a comparison
// or a troubleshooting page is not a development that happened this week — it
// is authored from documentation and from testing, and the engine has neither.
// Auto-generating article bodies for these would be exactly the filler the
// owner ruled out.
//
// So this files BRIEFS: a title, the question the piece answers, the structure
// it should follow, and the verified source it must be written from. A person
// writes it. Nothing here is published, and no article body is invented.
//
// EVERY SOURCE URL WAS FETCHED AND ITS TITLE CHECKED
// --------------------------------------------------
// Prusa's Knowledge Base URLs do NOT describe their content: the slug
// `asa_2033` returns "Calibration failed", and `warping_1807` and
// `clogged-extruder_1807` both return "Failing supports". The numeric id is
// authoritative and the slug is decoration. Citing a URL because its slug read
// correctly would have attached the wrong source to three of these briefs.
//
// Only URLs whose FETCHED TITLE matched the intended topic are used below.
// help.prusa3d.com/robots.txt allows crawling with a 10-second crawl delay.
//
//   npx tsx scripts/seed-evergreen-3d-printing.ts          (report)
//   npx tsx scripts/seed-evergreen-3d-printing.ts --apply

import { loadEnvLocal, createAdminClient } from "./_shared.ts";

const apply = process.argv.includes("--apply");

type EvergreenBrief = {
  title: string;
  primaryQuestion: string;
  supporting: string[];
  structure: string[];
  /** Verified: fetched, and the page title matched the topic. */
  sources: { url: string; verifiedTitle: string }[];
  note: string;
};

const BRIEFS: EvergreenBrief[] = [
  {
    title: "PLA vs PETG: which filament should you actually use?",
    primaryQuestion:
      "For a given print, when is PLA the right filament and when is PETG worth the extra difficulty?",
    supporting: [
      "What temperature ranges does each material actually need?",
      "How does each behave outdoors, in a hot car, or under load?",
      "Which is more forgiving for a first print, and why?",
      "What does each cost per kilogram at the time of writing?",
    ],
    structure: [
      "The short answer, stated in the first paragraph",
      "What PLA is good at, and its real limits",
      "What PETG buys you, and what it costs in print difficulty",
      "A side-by-side table of properties taken from the manufacturer documentation",
      "Which to choose for common jobs (prototypes, functional parts, outdoor parts)",
      "What this article does NOT cover: we have not lab-tested these materials",
    ],
    sources: [
      { url: "https://help.prusa3d.com/article/pla_2062", verifiedTitle: "PLA | Prusa Knowledge Base" },
      { url: "https://help.prusa3d.com/article/petg_2059", verifiedTitle: "PETG | Prusa Knowledge Base" },
    ],
    note:
      "Comparison must be sourced to manufacturer documentation and clearly attributed. Do not state " +
      "measured strength or temperature figures as TechCarvalho's own findings — we have run no tests.",
  },
  {
    title: "First layer problems: a diagnostic guide",
    primaryQuestion:
      "Your first layer is not sticking, is too thin, or is rippling — how do you work out which cause you actually have?",
    supporting: [
      "How do you tell a levelling problem from a temperature problem from a surface problem?",
      "What should a correct first layer look like?",
      "Which single adjustment fixes the largest share of cases?",
    ],
    structure: [
      "What a good first layer looks like, with the symptom named for each failure",
      "Diagnose by symptom, not by guessing: a decision path",
      "Nozzle height and levelling",
      "Bed surface, cleaning and adhesion",
      "Temperature and first-layer speed",
      "When the problem is the model rather than the printer",
    ],
    sources: [
      {
        url: "https://help.prusa3d.com/article/first-layer-troubleshooting_1804",
        verifiedTitle: "First layer issues | Prusa Knowledge Base",
      },
    ],
    note:
      "Written from vendor documentation. Where guidance is printer-specific, say so rather than " +
      "presenting one manufacturer's numbers as universal.",
  },
  {
    title: "Print quality troubleshooting: what the symptom tells you",
    primaryQuestion:
      "Given a visible defect on a finished print, what is the most likely cause and what should you change first?",
    supporting: [
      "Which defects point to a hardware fault rather than a slicer setting?",
      "Which are caused by material condition, such as damp filament?",
      "What should you change one at a time, and in what order?",
    ],
    structure: [
      "How to read a failed print",
      "Defects grouped by what they indicate (mechanical, thermal, material, slicer)",
      "The one-change-at-a-time rule and why it matters",
      "When to stop adjusting and check hardware",
    ],
    sources: [
      {
        url: "https://help.prusa3d.com/category/print-quality-troubleshooting_225",
        verifiedTitle: "Print quality troubleshooting | Prusa Knowledge Base",
      },
    ],
    note:
      "This is an index-style guide. It must link out to the specific documentation for each defect " +
      "rather than restating it, and must not imply TechCarvalho reproduced each fault.",
  },
];

async function main(): Promise<void> {
  loadEnvLocal();
  const db = await createAdminClient();

  const { data: existing, error } = await db
    .from("engine_briefs")
    .select("proposed_title, review_state");
  if (error) throw new Error(`briefs query failed: ${error.message}`);
  const taken = new Set(
    ((existing ?? []) as { proposed_title: string }[]).map((b) => b.proposed_title.toLowerCase().trim())
  );

  console.log(`\n${"=".repeat(76)}\nEVERGREEN 3D-PRINTING BRIEFS  ${apply ? "(APPLYING)" : "(report)"}\n${"=".repeat(76)}\n`);

  let created = 0;
  for (const b of BRIEFS) {
    if (taken.has(b.title.toLowerCase().trim())) {
      console.log(`  EXISTS  ${b.title}`);
      continue;
    }
    console.log(`  BRIEF   ${b.title}`);
    console.log(`          Q: ${b.primaryQuestion.slice(0, 88)}`);
    for (const s of b.sources) console.log(`          source: ${s.url}\n                  (verified title: ${s.verifiedTitle})`);

    if (!apply) { created++; continue; }

    const { error: insErr } = await db.from("engine_briefs").insert({
      proposed_title: b.title,
      proposed_slug: b.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90),
      content_type: "guide",
      category_slug: "3d-printing",
      rationale:
        `Evergreen 3D-printing coverage. ${b.note} Sources verified reachable on 2026-08-25 by ` +
        `fetching each URL and checking the returned page title matched the topic.`,
      state: "planned",
      review_state: "pending",
      brief_kind: "evergreen",
      primary_question: b.primaryQuestion,
      supporting_questions: b.supporting,
      suggested_structure: b.structure,
      source_urls: b.sources.map((s) => s.url),
      // Deliberately empty: no fact is asserted here. The writer establishes
      // them from the sources.
      verified_facts: [],
      uncertainties: [
        "TechCarvalho has not independently tested these materials or printers.",
        "Vendor documentation describes that vendor's hardware; generalise only where the source does.",
      ],
      freshness_sensitivity: "evergreen",
      related_product_slugs: [],
      related_content_slugs: [],
    });
    if (insErr) console.error(`          insert failed: ${insErr.message}`);
    else created++;
  }

  console.log(`\n  ${created} brief(s) ${apply ? "created" : "would be created"}.`);
  if (!apply) console.log("  re-run with --apply");
  console.log("  These are briefs for a person to write. Nothing is drafted or published.\n");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
