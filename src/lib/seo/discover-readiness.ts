// IS THIS ARTICLE A CREDIBLE CANDIDATE FOR GOOGLE DISCOVER?
//
// WHAT THIS IS NOT
// ----------------
// Not a ranking score, not a prediction, and not a claim that any of it earns
// placement. Google states plainly that content qualifies for Discover by being
// indexed and meeting the content policies, and that "no special tags or
// structured data are required". Nothing here can promise inclusion and this
// module must never be read as doing so.
//
// What it CAN do is check the things Google documents as requirements or
// recommendations, and say which of them a given article currently fails. Those
// are facts about our own pages, not guesses about Google's intentions.
//
// THE NUMBERS ARE GOOGLE'S, NOT MINE
// ----------------------------------
// From developers.google.com/search/docs/appearance/google-discover, read on
// 2026-08-27:
//
//   * images "at least 1200 px wide"
//   * "high resolution of more than 300,000 total pixels"
//   * a 16x9 aspect ratio
//   * large previews enabled via `max-image-preview:large` or AMP
//   * headlines that "capture the essence of the content"
//   * no "misleading or exaggerated details in preview content"
//   * no catering to "morbid curiosity, titillation, or outrage"
//   * a great page experience (Core Web Vitals)
//
// Anything this module cannot establish from data is reported as UNKNOWN rather
// than guessed. An image whose width was never recorded is not "too small"; it
// is unmeasured, and saying otherwise would be inventing a fact about a file.
//
// Pure. No I/O.

/** Google's stated minimum width for a Discover image. */
export const DISCOVER_MIN_WIDTH = 1200;
/** Google's stated minimum total pixel count. */
export const DISCOVER_MIN_PIXELS = 300_000;
/** Google's stated preferred aspect ratio, with tolerance for real crops. */
export const DISCOVER_TARGET_RATIO = 16 / 9;
export const DISCOVER_RATIO_TOLERANCE = 0.25;

export type ReadinessState =
  | "READY"
  | "NEEDS BETTER HERO IMAGE"
  | "IMAGE TOO SMALL"
  | "IMAGE UNMEASURED"
  | "NO HERO IMAGE"
  | "MISSING DATE"
  | "WEAK METADATA"
  | "NOT INDEXABLE";

export type ArticleForReadiness = {
  id: string;
  slug: string;
  title: string;
  status: string;
  publishedAt: string | null;
  updatedAt: string | null;
  /** The author or reviewer named on the page. Null when nobody is. */
  authorName: string | null;
  /** Meta description or excerpt. */
  description: string | null;
  hero: {
    width: number | null;
    height: number | null;
    altText: string | null;
    publicationStatus: string;
    /** A diagram or title card is not a photograph of anything. */
    isGraphic: boolean;
  } | null;
};

export type ReadinessFinding = {
  state: ReadinessState;
  /** Everything wrong, not just the first thing. */
  problems: string[];
  /** Things that are right, so a fix can be checked against them. */
  passes: string[];
};

/**
 * Words that promise more than an article can deliver.
 *
 * A SHORT list of the constructions Google's own policy names — exaggeration
 * and withheld information — not a general profanity filter. It flags for
 * REVIEW; it never rewrites a headline, because deciding what a headline should
 * say is an editorial act.
 */
const CLICKBAIT_PATTERNS: [RegExp, string][] = [
  [/\byou won'?t believe\b/i, "\"you won't believe\" withholds the point of the story"],
  [/\bshocking\b/i, "\"shocking\" is an appeal to outrage rather than a description"],
  [/\bthis one (trick|thing)\b/i, "\"this one trick\" withholds crucial information deliberately"],
  [/\b(everything|all) you need to know\b/i, "\"everything you need to know\" is a claim almost no article meets"],
  [/\bwhat happened next\b/i, "\"what happened next\" withholds the outcome"],
  [/\b(insane|crazy|mind-?blowing)\b/i, "sensational adjective in place of a fact"],
  [/!{2,}/, "multiple exclamation marks"],
];

function ratioOf(width: number, height: number): number {
  return height > 0 ? width / height : 0;
}

/**
 * Judge one article.
 *
 * ORDER MATTERS. Indexability outranks everything — an article Google cannot
 * index cannot appear anywhere, so a perfect image on a noindex page is not a
 * finding worth reporting first.
 */
export function assessDiscoverReadiness(article: ArticleForReadiness): ReadinessFinding {
  const problems: string[] = [];
  const passes: string[] = [];

  if (article.status !== "published") {
    return {
      state: "NOT INDEXABLE",
      problems: [`Status is "${article.status}", so the page is not public and cannot be indexed.`],
      passes: [],
    };
  }
  passes.push("Published and indexable.");

  // ---- dates ------------------------------------------------------------
  if (!article.publishedAt) {
    problems.push("No publication date. Discover is a freshness surface and an undated article cannot show one.");
  } else {
    passes.push(`Publication date present (${article.publishedAt.slice(0, 10)}).`);
  }

  // ---- transparency -----------------------------------------------------
  if (!article.authorName) {
    problems.push("Nobody is named on the page. Author or editor transparency is part of the quality guidance.");
  } else {
    passes.push(`Attributed to ${article.authorName}.`);
  }

  if (!article.description || article.description.trim().length < 50) {
    problems.push("No usable description, so the preview has nothing but the headline to work with.");
  } else {
    passes.push("Has a description of usable length.");
  }

  // ---- headline ---------------------------------------------------------
  const clickbait = CLICKBAIT_PATTERNS.filter(([re]) => re.test(article.title)).map(([, why]) => why);
  if (clickbait.length > 0) {
    for (const c of clickbait) problems.push(`Headline: ${c}.`);
  } else {
    passes.push("Headline makes no exaggerated or withholding claim.");
  }

  // ---- the image, which is what Discover is mostly about ----------------
  let imageState: ReadinessState | null = null;
  if (!article.hero) {
    imageState = "NO HERO IMAGE";
    problems.push("No hero image. Discover is an image-led surface; a card without one is not competitive.");
  } else if (article.hero.publicationStatus !== "published") {
    imageState = "NO HERO IMAGE";
    problems.push("The hero image is not published, so it cannot be shown publicly.");
  } else if (article.hero.width === null || article.hero.height === null) {
    imageState = "IMAGE UNMEASURED";
    problems.push(
      "The hero image has no recorded width or height, so it cannot be checked against Google's " +
        `${DISCOVER_MIN_WIDTH}px minimum. It may already be fine — this is a missing measurement, not a small image.`
    );
  } else {
    const { width, height } = article.hero;
    const pixels = width * height;
    const ratio = ratioOf(width, height);
    const tooNarrow = width < DISCOVER_MIN_WIDTH;
    const tooFewPixels = pixels < DISCOVER_MIN_PIXELS;
    const wrongShape = Math.abs(ratio - DISCOVER_TARGET_RATIO) > DISCOVER_RATIO_TOLERANCE;

    if (tooNarrow || tooFewPixels) {
      imageState = "IMAGE TOO SMALL";
      if (tooNarrow) problems.push(`Hero is ${width}px wide; Google states at least ${DISCOVER_MIN_WIDTH}px.`);
      if (tooFewPixels) {
        problems.push(
          `Hero is ${pixels.toLocaleString()} total pixels; Google states more than ${DISCOVER_MIN_PIXELS.toLocaleString()}.`
        );
      }
    } else {
      passes.push(`Hero is ${width}x${height} (${pixels.toLocaleString()} px), clearing Google's stated minimums.`);
    }

    if (wrongShape) {
      problems.push(
        `Hero aspect ratio is ${ratio.toFixed(2)}:1; Google states 16x9 (${DISCOVER_TARGET_RATIO.toFixed(2)}:1). ` +
          "It will be cropped, so check what survives the crop."
      );
      imageState = imageState ?? "NEEDS BETTER HERO IMAGE";
    }

    if (article.hero.isGraphic) {
      problems.push(
        "The hero is a diagram or title card rather than a photograph. Google's guidance is to avoid " +
          "generic or text-heavy images; this is honest about the subject but weak as a card."
      );
      imageState = imageState ?? "NEEDS BETTER HERO IMAGE";
    }

    if (!article.hero.altText || article.hero.altText.trim().length < 10) {
      problems.push("The hero image has no meaningful alt text.");
    } else {
      passes.push("Hero image has descriptive alt text.");
    }
  }

  // ---- the single headline state ----------------------------------------
  //
  // One state, chosen by what an editor would fix FIRST. Everything else is
  // still listed in `problems` — the state is a label, not a summary.
  const state: ReadinessState =
    imageState ??
    (!article.publishedAt ? "MISSING DATE" : problems.length > 0 ? "WEAK METADATA" : "READY");

  return { state, problems, passes };
}

/** Group findings for a report, most-common problem first. */
export function summariseReadiness(findings: readonly ReadinessFinding[]): Map<ReadinessState, number> {
  const counts = new Map<ReadinessState, number>();
  for (const f of findings) counts.set(f.state, (counts.get(f.state) ?? 0) + 1);
  return new Map([...counts.entries()].sort((a, b) => b[1] - a[1]));
}
