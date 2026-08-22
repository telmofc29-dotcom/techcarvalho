// Draft assembly: approved brief -> pre-populated DRAFT body.
//
// The single rule this module exists to enforce: the engine never writes
// factual prose. It writes STRUCTURE and QUOTED EVIDENCE.
//
// A verified fact appears as a quotation with its provenance attached. Anything
// unconfirmed appears in an explicit "Unverified" block phrased as an
// attributed claim, with a standing instruction not to state it as fact. The
// human writing the article can then see exactly what is established and what
// is not — which is the opposite of handing them plausible-sounding prose whose
// reliability they cannot assess.
//
// Deterministic. No AI provider is involved, and none is required.

export type DraftInput = {
  title: string;
  contentType: string;
  categorySlug: string | null;
  primaryQuestion: string | null;
  supportingQuestions: string[];
  verifiedFacts: string[];
  uncertainties: string[];
  sourceUrls: string[];
  suggestedStructure: string[];
  briefKind: string | null;
  freshnessSensitivity: string | null;
  rationale: string;
  relatedContent: { title: string; slug: string }[];
  relatedProducts: { name: string; slug: string; isPublished: boolean }[];
};

export type AssembledDraft = {
  body: string;
  wordCountEstimate: number;
  hasVerifiedFacts: boolean;
  requiresAttributionThroughout: boolean;
};

const EDITOR_BANNER = `<!-- ENGINE-ASSEMBLED DRAFT — NOT PUBLISHABLE AS-IS.
This body was assembled from recorded evidence. It contains structure and
quoted evidence only; no sentence here is finished editorial prose. Rewrite
each section in TechCarvalho's voice, keep every factual claim traceable to
the sources listed, and delete this comment before publishing. -->`;

export function assembleDraft(input: DraftInput): AssembledDraft {
  const hasVerifiedFacts = input.verifiedFacts.length > 0;
  // If nothing reached primary confirmation, the entire piece must be written
  // in attributed voice. That instruction is stated once, prominently.
  const requiresAttributionThroughout = !hasVerifiedFacts;

  const parts: string[] = [EDITOR_BANNER, ""];

  parts.push(`## Why this is being covered`, "", input.rationale, "");

  if (input.primaryQuestion) {
    parts.push(`## The question this piece answers`, "", input.primaryQuestion, "");
  }

  if (input.supportingQuestions.length) {
    parts.push(`### Supporting questions to address`, "");
    for (const q of input.supportingQuestions) parts.push(`- ${q}`);
    parts.push("");
  }

  // --- Evidence, split hard ---
  parts.push(`## Evidence`, "");

  if (hasVerifiedFacts) {
    parts.push(`### Verified — may be stated directly`, "");
    for (const f of input.verifiedFacts) parts.push(`- ${f}`);
    parts.push("");
  } else {
    parts.push(
      `### Verified — may be stated directly`,
      "",
      `_Nothing in this brief reached primary confirmation._ **Every factual claim in this article must be written as an attributed claim** ("X reports…", "According to Y…"), not as an assertion in TechCarvalho's own voice.`,
      ""
    );
  }

  if (input.uncertainties.length) {
    parts.push(
      `### Unverified — DO NOT state as fact`,
      "",
      `The following are claims, not established facts. Attribute each one, or omit it.`,
      ""
    );
    for (const u of input.uncertainties) parts.push(`- ${u}`);
    parts.push("");
  }

  // --- Structure skeleton ---
  parts.push(`## Suggested structure`, "");
  const structure = input.suggestedStructure.length
    ? input.suggestedStructure
    : ["What this is", "Why it matters", "What to do about it"];
  for (const heading of structure) {
    parts.push(`### ${heading}`, "", `_[Write this section. Use only the evidence above.]_`, "");
  }

  // --- Honest-limits prompt, tuned to the piece type ---
  parts.push(`### When this does NOT matter to the reader`, "");
  parts.push(
    `_[TechCarvalho articles say plainly who should ignore this. Fill in the case where the reader can safely do nothing.]_`,
    ""
  );

  // --- Internal links ---
  if (input.relatedContent.length || input.relatedProducts.length) {
    parts.push(`## Suggested internal links`, "");
    for (const c of input.relatedContent) {
      parts.push(`- [${c.title}](/articles/${c.slug})`);
    }
    for (const p of input.relatedProducts) {
      // A draft must never link to an unpublished product — that would be a
      // broken public link the moment this article goes live.
      parts.push(
        p.isPublished
          ? `- [${p.name}](/products/${p.slug})`
          : `- ${p.name} — _product not yet published; do not link until it is_`
      );
    }
    parts.push("");
  }

  // --- Sources ---
  parts.push(`## Sources`, "");
  if (input.sourceUrls.length) {
    for (const url of input.sourceUrls) parts.push(`- ${url}`);
  } else {
    parts.push(`_No source URLs recorded. Do not publish without sources._`);
  }
  parts.push("");

  if (input.freshnessSensitivity) {
    parts.push(
      `## Freshness`,
      "",
      input.freshnessSensitivity === "breaking"
        ? `Breaking — verify every claim is still current immediately before publishing.`
        : input.freshnessSensitivity === "time_sensitive"
          ? `Time-sensitive — re-check specifics (pricing, availability) before publishing.`
          : `Evergreen — should stay accurate, but re-check any figures.`,
      ""
    );
  }

  const body = parts.join("\n");
  return {
    body,
    wordCountEstimate: body.split(/\s+/).filter(Boolean).length,
    hasVerifiedFacts,
    requiresAttributionThroughout,
  };
}

// ---------------------------------------------------------------------------
// Publication guard
// ---------------------------------------------------------------------------
// An assembled body is scaffolding: an editor banner, section placeholders, and
// a standing "do not state as fact" block. Publishing one untouched would put
// instructions-to-the-writer on the public site, and worse, publish an
// "Unverified — DO NOT state as fact" list as though it were an article.
//
// status='draft' and the media gate both stand in the way already, but neither
// is aimed at THIS mistake — an editor who adds a hero image and flips the
// status has satisfied both. So the markers are checked directly at the point
// of publication.
//
// Each marker is a literal string this module writes. They are defined here,
// beside the code that emits them, so the two cannot drift apart.
export const ASSEMBLY_MARKERS: { marker: string; meaning: string }[] = [
  { marker: "<!-- ENGINE-ASSEMBLED DRAFT", meaning: "the engine's editor banner is still in the body" },
  { marker: "[Write this section", meaning: "a section placeholder has not been written" },
  { marker: "DO NOT state as fact", meaning: "the unverified-claims block has not been resolved" },
  { marker: "Fill in the case where the reader", meaning: "the honest-limits prompt has not been answered" },
  { marker: "Do not publish without sources", meaning: "the draft still has no sources" },
];

/**
 * Assembly scaffolding still present in a body. Empty means it is safe to
 * publish as far as this check is concerned.
 */
export function findUnfinishedAssemblyMarkers(body: string | null | undefined): string[] {
  if (!body) return [];
  return ASSEMBLY_MARKERS.filter((m) => body.includes(m.marker)).map((m) => m.meaning);
}

/** SEO metadata proposal. Kept conservative — no invented claims. */
export function proposeSeo(input: { title: string; primaryQuestion: string | null }): {
  metaTitle: string;
  metaDescription: string | null;
} {
  const metaTitle = input.title.length > 60 ? input.title.slice(0, 57).trimEnd() + "…" : input.title;
  // Only derive a description from the brief's own question — never invent a
  // sales pitch for an article nobody has written yet.
  const metaDescription = input.primaryQuestion
    ? input.primaryQuestion.replace(/\s*\([^)]*\)\s*$/, "").slice(0, 155)
    : null;
  return { metaTitle, metaDescription };
}
