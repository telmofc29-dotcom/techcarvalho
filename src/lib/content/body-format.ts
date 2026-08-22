// Article body rendering. content_items.body is a plain text column (see
// src/lib/types/database.ts) — no rich-text/JSON block schema exists, and a
// full WYSIWYG editor isn't justified for the current, small-scale
// editorial workflow. The previous renderer split on blank lines only
// (paragraphs, nothing else), which meant an editor had no way to add a
// subheading or a bullet list to a review/guide — a genuine gap for real
// editorial work. This adds a minimal, dependency-free block parser
// supporting exactly three conventions: `## `/`### ` headings, `- ` list
// items, and blank-line-separated paragraphs. No inline emphasis/links —
// if that's ever needed, it's a signal to revisit the body model itself
// (e.g. stored blocks) rather than growing this parser further.

export type BodyBlock =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; text: string };

export function parseBodyBlocks(body: string): BodyBlock[] {
  const blocks: BodyBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraphLines.join(" ").trim() });
      paragraphLines = [];
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ kind: "list", items: listItems });
      listItems = [];
    }
  };

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();

    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = /^(##|###)\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: headingMatch[1].length === 2 ? 2 : 3, text: headingMatch[2].trim() });
      continue;
    }

    const listMatch = /^-\s+(.+)$/.exec(line);
    if (listMatch) {
      flushParagraph();
      listItems.push(listMatch[1].trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}

// Roughly the length Google will render before truncating. Not a hard limit —
// a description longer than this isn't invalid, it just gets cut off — so
// this is used to trim a *derived* description, never to reject an
// editor-written one.
const DERIVED_DESCRIPTION_MAX = 160;

// Last-resort meta description for a piece whose editor never wrote one.
//
// Not a summary and not generated text: it is the article's own opening
// paragraph, trimmed at a word boundary. That keeps it honest (the site
// cannot claim something the body doesn't say) while making sure every
// article has a description of its own rather than falling back to the site
// tagline, which is what previously left every description-less article
// sharing one identical <meta name="description"> with every other page.
//
// Returns null rather than a truncated fragment when there is no usable
// prose — an empty description is better than a misleading one.
export function excerptFromBody(body: string | null | undefined): string | null {
  if (!body) return null;
  const firstParagraph = parseBodyBlocks(body).find((block) => block.kind === "paragraph");
  if (!firstParagraph) return null;

  const text = firstParagraph.text.replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  if (text.length <= DERIVED_DESCRIPTION_MAX) return text;

  const cut = text.slice(0, DERIVED_DESCRIPTION_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  // A "paragraph" with no spaces in its first 160 characters isn't prose.
  if (lastSpace <= 0) return null;
  return `${cut.slice(0, lastSpace).replace(/[.,;:—-]+$/, "")}…`;
}
