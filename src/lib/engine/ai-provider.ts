// AI provider abstraction for the Growth Engine.
//
// Deliberately an interface with a null implementation and NOTHING ELSE. No
// vendor SDK is imported, no API key is read, no network call is possible, and
// no recurring cost can be incurred. Adding a real provider is an explicit,
// separately-approved decision — per the standing instruction not to add a paid
// AI API without approval.
//
// The point of the abstraction is that the rest of TechCarvalho depends on this
// interface, never on a vendor. Swapping in OpenAI, Anthropic, Gemini, or a
// locally-hosted model later means writing one class here and changing the
// factory below — no call site changes.
//
// Equally important: everything the engine does today (discovery, dedupe,
// confidence, opportunity scoring, freshness detection, brief assembly) is
// deterministic code that runs WITHOUT any AI provider. AI is reserved for the
// narrow set of tasks where language/reasoning genuinely helps — it is not
// load-bearing for the engine to function.

export type DraftRequest = {
  title: string;
  /** Verified evidence the draft must stay within. Never free invention. */
  evidence: { url: string; publisher: string | null; excerpt: string | null }[];
  contentType: string;
  targetQuery: string | null;
};

export type SummariseRequest = {
  text: string;
  maxWords: number;
};

export type AiCapability = "summarise" | "draft_outline" | "rewrite_headline" | "classify_topic";

export interface AiProvider {
  readonly name: string;
  isConfigured(): boolean;
  supports(capability: AiCapability): boolean;
  summarise(request: SummariseRequest): Promise<string | null>;
  draftOutline(request: DraftRequest): Promise<string[] | null>;
  classifyTopic(text: string, candidates: string[]): Promise<string | null>;
}

/**
 * The only implementation that exists today. Every method returns null, which
 * every caller must handle — so an unconfigured engine degrades to "no
 * AI-assisted step happened", never to a fabricated result.
 */
export class NullAiProvider implements AiProvider {
  readonly name = "none";
  isConfigured(): boolean {
    return false;
  }
  supports(): boolean {
    return false;
  }
  async summarise(): Promise<string | null> {
    return null;
  }
  async draftOutline(): Promise<string[] | null> {
    return null;
  }
  async classifyTopic(): Promise<string | null> {
    return null;
  }
}

/**
 * Single place that decides which provider backs the engine. Mirrors
 * getAnalyticsDataProvider() in src/lib/analytics/dashboard-types.ts, which
 * follows the same "null provider until credentials exist" pattern.
 *
 * Intentionally always returns NullAiProvider right now. When a provider is
 * approved, construct it here behind an env-var check — do not scatter vendor
 * checks through the codebase.
 */
export function getAiProvider(): AiProvider {
  return new NullAiProvider();
}

/**
 * What a real provider would be used for, recorded here so the decision can be
 * evaluated on merit later rather than reconstructed from memory. Each of these
 * is genuinely language work — none of them is a substitute for the
 * deterministic logic that already exists.
 */
export const AI_USE_CASES: { capability: AiCapability; purpose: string; deterministicAlternative: string }[] = [
  {
    capability: "summarise",
    purpose: "Condense a long press release into a 2-3 sentence discovery summary.",
    deterministicAlternative: "Store the source excerpt verbatim (what happens today).",
  },
  {
    capability: "draft_outline",
    purpose: "Propose a section outline for a brief, constrained to recorded evidence.",
    deterministicAlternative: "Template outline by content type (what happens today).",
  },
  {
    capability: "rewrite_headline",
    purpose: "Suggest clearer working titles for a brief.",
    deterministicAlternative: "Use the discovery title unchanged (what happens today).",
  },
  {
    capability: "classify_topic",
    purpose: "Map an ambiguous announcement to the right existing category.",
    deterministicAlternative: "Keyword match against category slugs (what happens today).",
  },
];
