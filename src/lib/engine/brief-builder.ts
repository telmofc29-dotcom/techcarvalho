import type { ContentAngle } from "./relevance.ts";
import { computeConfidence, isPublishableAsFact } from "./confidence.ts";
import type { ClaimStatus, TrustLevel } from "./types.ts";

// Deterministic brief construction.
//
// A brief is NOT an article. It is the structured question-and-evidence packet
// a human (or, later, a language model under supervision) needs in order to
// write one. Nothing here generates prose.
//
// The single most important behaviour: the verified/uncertain split. Facts only
// enter `verifiedFacts` when their evidence genuinely supports assertion; every
// other claim lands in `uncertainties` phrased as a claim ATTRIBUTED to a
// source, never as a statement of fact. This is the mechanism that stops an
// unconfirmed rumour becoming an assertion three stages downstream.

export type BriefKind =
  | "breaking"
  | "evergreen"
  | "product"
  | "comparison"
  | "troubleshooting"
  | "buying_guide"
  | "explainer"
  | "update_existing";

export type FreshnessSensitivity = "breaking" | "time_sensitive" | "evergreen";

export type BriefInput = {
  title: string;
  summary: string | null;
  discoveryType: string;
  categorySlug: string | null;
  claimStatus: ClaimStatus;
  suggestedAngle: ContentAngle | null;
  sightingCount: number;
  evidence: {
    url: string;
    publisher: string | null;
    claim_status: ClaimStatus;
    trust_level: TrustLevel;
    originates_from_url: string | null;
  }[];
};

export type Brief = {
  proposedTitle: string;
  rationale: string;
  primaryQuestion: string;
  supportingQuestions: string[];
  verifiedFacts: string[];
  uncertainties: string[];
  sourceUrls: string[];
  suggestedStructure: string[];
  briefKind: BriefKind;
  freshnessSensitivity: FreshnessSensitivity;
  contentType: "review" | "guide" | "comparison" | "news" | "troubleshooting";
  priority: number;
  mediaRequirementNote: string;
};

const ANGLE_TO_KIND: Record<ContentAngle, BriefKind> = {
  product_launch: "product",
  hardware: "product",
  software_update: "breaking",
  compatibility: "explainer",
  security: "breaking",
  recall: "breaking",
  bug_or_problem: "troubleshooting",
  performance: "explainer",
  specifications: "product",
  pricing: "buying_guide",
  discontinuation: "update_existing",
  comparison: "comparison",
  buying_question: "buying_guide",
  emerging_tech: "explainer",
  // An eclipse or an aurora is useful to a reader as a planning guide — when
  // to be where, with what settings — not as a news report of the event.
  observable_event: "explainer",
};

const KIND_TO_CONTENT_TYPE: Record<BriefKind, Brief["contentType"]> = {
  breaking: "news",
  evergreen: "guide",
  product: "news",
  comparison: "comparison",
  troubleshooting: "troubleshooting",
  buying_guide: "guide",
  explainer: "guide",
  update_existing: "news",
};

// Angles whose value decays quickly vs those that stay useful for years.
const BREAKING_ANGLES = new Set<ContentAngle>(["recall", "security", "software_update"]);
const EVERGREEN_ANGLES = new Set<ContentAngle>([
  "comparison", "buying_question", "compatibility", "emerging_tech", "performance",
]);

function structureFor(kind: BriefKind): string[] {
  switch (kind) {
    case "comparison":
      return ["What each option actually is", "Where they genuinely differ", "Which to pick for which use case", "When neither is the right answer"];
    case "buying_guide":
      return ["What actually matters in this category", "What does not matter as much as marketing suggests", "Recommendations by use case", "When not to buy at all"];
    case "troubleshooting":
      return ["The symptom, stated precisely", "Most likely causes in order of likelihood", "How to test each", "When it is a hardware fault"];
    case "explainer":
      return ["What the thing is", "How it actually works", "What it changes in practice", "What it does not fix"];
    case "breaking":
      return ["What is confirmed", "What is claimed but unconfirmed", "Who it affects", "What to do now"];
    case "update_existing":
      return ["What changed", "Which existing articles are affected", "What needs correcting"];
    default:
      return ["What it is", "Verified specifications", "How it compares to what exists", "Who it is for"];
  }
}

export function buildBrief(input: BriefInput): Brief {
  const confidence = computeConfidence(input.evidence);
  const angle = input.suggestedAngle;
  const kind: BriefKind = angle ? ANGLE_TO_KIND[angle] : "explainer";
  const contentType = KIND_TO_CONTENT_TYPE[kind];

  const freshnessSensitivity: FreshnessSensitivity =
    angle && BREAKING_ANGLES.has(angle)
      ? "breaking"
      : angle && EVERGREEN_ANGLES.has(angle)
        ? "evergreen"
        : "time_sensitive";

  // The verified/uncertain split. Only a genuinely primary-confirmed claim is
  // stated as fact; everything else is recorded as an attributed claim so a
  // writer cannot mistake it for something established.
  const verifiedFacts: string[] = [];
  const uncertainties: string[] = [];

  const publishableAsFact = isPublishableAsFact(confidence);
  const primaryPublishers = [
    ...new Set(
      input.evidence.filter((e) => e.trust_level === "primary" && !e.originates_from_url).map((e) => e.publisher).filter(Boolean)
    ),
  ] as string[];

  if (publishableAsFact) {
    verifiedFacts.push(
      `"${input.title}" is confirmed by a primary source${primaryPublishers.length ? ` (${primaryPublishers.join(", ")})` : ""}. Confidence ${confidence.confidence}.`
    );
  } else {
    uncertainties.push(
      `"${input.title}" is NOT primary-confirmed (status: ${confidence.effectiveClaimStatus}, confidence ${confidence.confidence}). Report it as a claim attributed to its source, never as established fact.`
    );
  }

  if (confidence.derivativeSources > 0) {
    uncertainties.push(
      `${confidence.derivativeSources} of ${input.evidence.length} source(s) repeat another source's claim rather than confirming independently — corroboration is weaker than the raw source count suggests.`
    );
  }
  if (confidence.independentSources <= 1 && !publishableAsFact) {
    uncertainties.push("Only one independent source. Seek a second before asserting anything specific.");
  }

  const primaryQuestion = questionFor(kind, input.title);
  const supportingQuestions = supportingFor(kind);

  // Priority blends corroboration with time-sensitivity — a recall outranks a
  // spec sheet. Deliberately coarse: this orders a human review queue, it does
  // not make decisions.
  let priority = 40;
  if (freshnessSensitivity === "breaking") priority += 30;
  if (angle === "recall" || angle === "security") priority += 15;
  priority += Math.min(input.sightingCount * 3, 15);
  if (publishableAsFact) priority += 10;
  priority = Math.min(priority, 100);

  const rationale =
    `Angle "${angle ?? "general"}" (${kind}). ${confidence.explanation} ` +
    `Seen ${input.sightingCount} time(s) across ${input.evidence.length} evidence row(s). ` +
    (publishableAsFact
      ? "Primary-confirmed, so specifics may be stated directly."
      : "Not primary-confirmed — must be written as attributed claims.");

  return {
    proposedTitle: input.title.slice(0, 300),
    rationale,
    primaryQuestion,
    supportingQuestions,
    verifiedFacts,
    uncertainties,
    sourceUrls: [...new Set(input.evidence.map((e) => e.url))],
    suggestedStructure: structureFor(kind),
    briefKind: kind,
    freshnessSensitivity,
    contentType,
    priority,
    // Media is never assumed. Every brief inherits the standing rule.
    mediaRequirementNote:
      "Requires a hero image before publication. Manufacturer product photography is NOT cleared for republication — use an original TechCarvalho diagram/table, or leave the record Draft/Awaiting Media.",
  };
}

function questionFor(kind: BriefKind, title: string): string {
  switch (kind) {
    case "comparison": return `Which option should a reader actually choose, and why? (${title})`;
    case "buying_guide": return `Is this worth buying, and for whom? (${title})`;
    case "troubleshooting": return `What causes this problem and how does a reader fix it? (${title})`;
    case "explainer": return `What does this actually change for a normal user? (${title})`;
    case "breaking": return `What is confirmed, who is affected, and what should they do? (${title})`;
    case "update_existing": return `Which existing TechCarvalho content is now out of date because of this? (${title})`;
    default: return `What is it, and who is it genuinely for? (${title})`;
  }
}

function supportingFor(kind: BriefKind): string[] {
  const common = ["Who is genuinely affected?", "When does this NOT matter to the reader?"];
  switch (kind) {
    case "comparison": return ["What are the real, measurable differences?", "Is the price gap justified?", ...common];
    case "buying_guide": return ["What specs actually matter here?", "What is the cheapest option that still works?", ...common];
    case "troubleshooting": return ["What is the most common cause?", "What free checks come before spending money?", ...common];
    case "breaking": return ["What is confirmed vs merely reported?", "Is there an action the reader must take?", ...common];
    default: return ["What existing TechCarvalho content relates to this?", ...common];
  }
}
