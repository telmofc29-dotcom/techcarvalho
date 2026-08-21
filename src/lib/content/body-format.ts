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
