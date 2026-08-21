// Generates original TechCarvalho editorial hero graphics for content records
// that are blocked on media.
//
// These are EDITORIAL TITLE CARDS, not depictions of products. That
// distinction is deliberate and load-bearing: TechCarvalho cannot legitimately
// obtain manufacturer product photography, and fabricating something that
// looks like a photo of a real product would be dishonest. A typographic card
// with category theming is honest about what it is — the same thing a
// magazine uses when it has no photograph.
//
// Everything produced here is TechCarvalho-owned original work, so
// source_type='tc_graphic', owned=true, rights_status='verified',
// ai_generated=false.
//
// Usage:
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... node scripts/generate-editorial-heroes.mjs [--limit N] [--dry]

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import sharp from "sharp";

const envLocal = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envLocal.split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const limitArg = argv.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Number(argv[limitArg + 1]) : 100;

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const { data: auth, error: authErr } = await admin.auth.signInWithPassword({
  email: process.env.TC_ADMIN_EMAIL,
  password: process.env.TC_ADMIN_PASSWORD,
});
if (authErr) {
  console.error("sign-in failed:", authErr.message);
  process.exit(1);
}
const userId = auth.user.id;

const OUT = "C:\\Users\\info\\AppData\\Local\\Temp\\claude\\C--Projects-TechCarvalho\\3ef1c09d-ae92-4361-b318-9f5d96e1a40d\\scratchpad\\editorial-heroes\\";
mkdirSync(OUT, { recursive: true });

const W = 1600, H = 900;

// Per-category palette. Distinct enough that a reader can tell categories
// apart at a glance in a card grid.
const THEME = {
  "cameras-photography": { a: "#0f172a", b: "#334155", accent: "#38bdf8", motif: "aperture" },
  astrophotography:      { a: "#0b1026", b: "#1e1b4b", accent: "#a78bfa", motif: "stars" },
  computing:             { a: "#0c1a2b", b: "#123a5c", accent: "#38bdf8", motif: "circuit" },
  gaming:                { a: "#1b0f2b", b: "#3b1a5c", accent: "#c084fc", motif: "grid" },
  networking:            { a: "#062b2b", b: "#0e4f4f", accent: "#2dd4bf", motif: "waves" },
  "smart-home-robots":   { a: "#12240f", b: "#22491c", accent: "#84cc16", motif: "grid" },
  "drones-fpv":          { a: "#2b1405", b: "#5c2c0b", accent: "#fb923c", motif: "rotors" },
  "action-cameras":      { a: "#2b0b0b", b: "#5c1717", accent: "#f87171", motif: "aperture" },
  smartphones:           { a: "#06241c", b: "#0b4a38", accent: "#34d399", motif: "grid" },
  "ai-hardware":         { a: "#2b0a1e", b: "#5c1440", accent: "#f472b6", motif: "circuit" },
  _default:              { a: "#111827", b: "#334155", accent: "#ea580c", motif: "grid" },
};

const TYPE_LABEL = {
  guide: "GUIDE",
  comparison: "COMPARISON",
  news: "NEWS",
  troubleshooting: "TROUBLESHOOTING",
  review: "REVIEW",
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Deterministic per-slug pseudo-random, so a given article always renders identically. */
function seeded(slug) {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) { h ^= slug.charCodeAt(i); h = Math.imul(h, 16777619); }
  let s = h >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function motifSvg(kind, accent, rnd) {
  const o = [];
  if (kind === "stars") {
    for (let i = 0; i < 90; i++) {
      const x = rnd() * W, y = rnd() * H * 0.85, r = rnd() * 1.9 + 0.4;
      o.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#fff" opacity="${(0.15 + rnd() * 0.6).toFixed(2)}"/>`);
    }
  } else if (kind === "circuit") {
    for (let i = 0; i < 16; i++) {
      const y = 70 + rnd() * (H - 200), x1 = rnd() * W * 0.5, len = 120 + rnd() * 420;
      o.push(`<path d="M${x1.toFixed(0)} ${y.toFixed(0)} h${(len * 0.6).toFixed(0)} l40 40 h${(len * 0.4).toFixed(0)}" fill="none" stroke="${accent}" stroke-width="1.6" opacity="0.22"/>`);
      o.push(`<circle cx="${(x1 + len * 0.6 + 40 + len * 0.4).toFixed(0)}" cy="${(y + 40).toFixed(0)}" r="4" fill="${accent}" opacity="0.5"/>`);
    }
  } else if (kind === "waves") {
    for (let i = 0; i < 7; i++) {
      const r = 120 + i * 105;
      o.push(`<circle cx="${W - 210}" cy="${H / 2}" r="${r}" fill="none" stroke="${accent}" stroke-width="1.6" opacity="${(0.3 - i * 0.035).toFixed(2)}"/>`);
    }
  } else if (kind === "aperture") {
    const cx = W - 300, cy = H / 2, R = 210;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      o.push(`<path d="M${cx + Math.cos(a) * R} ${cy + Math.sin(a) * R} L${cx + Math.cos(a + 1.05) * R} ${cy + Math.sin(a + 1.05) * R} L${cx} ${cy} Z" fill="none" stroke="${accent}" stroke-width="1.8" opacity="0.28"/>`);
    }
    o.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${accent}" stroke-width="2" opacity="0.35"/>`);
  } else if (kind === "rotors") {
    for (const [cx, cy] of [[W - 330, 230], [W - 130, 230], [W - 330, 470], [W - 130, 470]]) {
      o.push(`<circle cx="${cx}" cy="${cy}" r="82" fill="none" stroke="${accent}" stroke-width="2" opacity="0.3"/>`);
      o.push(`<line x1="${cx - 60}" y1="${cy}" x2="${cx + 60}" y2="${cy}" stroke="${accent}" stroke-width="2" opacity="0.35"/>`);
    }
  } else {
    for (let x = 0; x < W; x += 62) o.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${accent}" stroke-width="1" opacity="0.09"/>`);
    for (let y = 0; y < H; y += 62) o.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${accent}" stroke-width="1" opacity="0.09"/>`);
  }
  return o.join("");
}

/** Wrap a title into lines that fit the card. */
function wrap(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) { lines.push(cur.trim()); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

function heroSvg({ title, type, categoryLabel, slug }) {
  const theme = THEME[slug.categorySlug] ?? THEME._default;
  const rnd = seeded(slug.slug);
  const isComparison = type === "comparison";

  // Comparison pieces get a split treatment with an explicit VS, which is
  // editorially meaningful rather than just decorative.
  let titleBlock = "";
  if (isComparison) {
    const parts = title.split(/\s+vs\.?\s+/i);
    const left = wrap(parts[0] ?? title, 22);
    const right = wrap((parts[1] ?? "").replace(/[:–—-].*$/, "").trim(), 22);
    titleBlock =
      left.map((l, i) => `<text x="110" y="${430 + i * 58}" font-family="Arial,Helvetica,sans-serif" font-size="50" font-weight="700" fill="#fff">${esc(l)}</text>`).join("") +
      `<text x="110" y="${430 + left.length * 58 + 26}" font-family="Arial,Helvetica,sans-serif" font-size="40" font-weight="800" fill="${theme.accent}">VS</text>` +
      right.map((l, i) => `<text x="200" y="${430 + left.length * 58 + 26 + i * 52}" font-family="Arial,Helvetica,sans-serif" font-size="44" font-weight="700" fill="#e5e7eb">${esc(l)}</text>`).join("");
  } else {
    const lines = wrap(title, 30);
    const startY = 470 - (lines.length - 1) * 30;
    titleBlock = lines
      .map((l, i) => `<text x="110" y="${startY + i * 62}" font-family="Arial,Helvetica,sans-serif" font-size="54" font-weight="700" fill="#fff">${esc(l)}</text>`)
      .join("");
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${theme.a}"/><stop offset="1" stop-color="${theme.b}"/>
  </linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  ${motifSvg(theme.motif, theme.accent, rnd)}
  <rect x="110" y="196" width="${(TYPE_LABEL[type] ?? "ARTICLE").length * 15 + 40}" height="42" rx="21" fill="${theme.accent}"/>
  <text x="130" y="225" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="700" fill="#0b1020" letter-spacing="1.5">${esc(TYPE_LABEL[type] ?? "ARTICLE")}</text>
  <text x="110" y="300" font-family="Arial,Helvetica,sans-serif" font-size="26" font-weight="600" fill="${theme.accent}" letter-spacing="2">${esc(String(categoryLabel).toUpperCase())}</text>
  ${titleBlock}
  <text x="110" y="${H - 70}" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700" fill="#fff" opacity="0.92">TechCarvalho</text>
  <text x="300" y="${H - 70}" font-family="Arial,Helvetica,sans-serif" font-size="18" fill="#cbd5e1" opacity="0.75">Original editorial graphic</text>
  <rect x="0" y="${H - 14}" width="${W}" height="14" fill="#ea580c"/>
</svg>`;
}

// ---- Load blocked content ----
const { data: cats } = await admin.from("taxonomy_categories").select("id, slug, name");
const catById = Object.fromEntries((cats ?? []).map((c) => [c.id, c]));

const { data: blocked, error: blockedErr } = await admin
  .from("content_items")
  .select("id, slug, title, type, category_id")
  .eq("status", "awaiting_media")
  .order("slug")
  .limit(LIMIT);
if (blockedErr) { console.error("query failed:", blockedErr.message); process.exit(1); }

console.log(`content awaiting media: ${blocked.length}${DRY ? "  (DRY RUN)" : ""}\n`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });

let generated = 0, skipped = 0, failed = 0;

for (const row of blocked) {
  // Never overwrite an existing hero.
  const { data: existing } = await admin
    .from("content_media").select("media_id").eq("content_id", row.id).eq("role", "hero").maybeSingle();
  if (existing) { skipped++; console.log(`  skip (has hero): ${row.slug}`); continue; }

  const cat = catById[row.category_id];
  const svg = heroSvg({
    title: row.title,
    type: row.type,
    categoryLabel: cat?.name ?? "TechCarvalho",
    slug: { slug: row.slug, categorySlug: cat?.slug ?? "_default" },
  });

  const file = `${OUT}hero-${row.slug}.png`;
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`, { waitUntil: "load" });
  await page.screenshot({ path: file });

  if (DRY) { generated++; console.log(`  would generate: ${row.slug}`); continue; }

  const buf = readFileSync(file);
  const meta = await sharp(buf).metadata();
  const storagePath = `image/${randomUUID()}-hero-${row.slug}.png`;

  const { error: upErr } = await admin.storage.from("media-private").upload(storagePath, buf, { contentType: "image/png" });
  if (upErr) { failed++; console.log(`  UPLOAD FAIL ${row.slug}: ${upErr.message}`); continue; }

  const { data: asset, error: insErr } = await admin.from("media_assets").insert({
    media_type: "image",
    storage_path: storagePath,
    alt_text: `TechCarvalho editorial graphic for "${row.title}" — ${cat?.name ?? "technology"} ${row.type}`,
    width: meta.width,
    height: meta.height,
    owned: true,
    rights_status: "verified",
    source_type: "tc_graphic",
    asset_role: "article_hero",
    ai_generated: false,
    attribution_required: false,
    publication_status: "private",
  }).select().single();
  if (insErr) { failed++; console.log(`  INSERT FAIL ${row.slug}: ${insErr.message}`); continue; }

  const { error: copyErr } = await admin.storage.from("media-private").copy(storagePath, storagePath, { destinationBucket: "media-public" });
  if (copyErr) { failed++; console.log(`  COPY FAIL ${row.slug}: ${copyErr.message}`); continue; }

  await admin.from("media_assets").update({
    publication_status: "published", public_storage_path: storagePath,
    published_at: new Date().toISOString(), published_by: userId,
  }).eq("id", asset.id);

  await admin.from("content_media").insert({ content_id: row.id, media_id: asset.id, role: "hero", sort_order: 0 });

  // Resolve the media requirement rather than leaving it open.
  await admin.from("media_requirements")
    .update({ sourcing_status: "approved", resolved_media_id: asset.id, target_source_type: "tc_graphic",
              notes: "Resolved with an original TechCarvalho editorial graphic (owned outright).",
              updated_at: new Date().toISOString() })
    .eq("content_id", row.id);

  generated++;
  console.log(`  ✓ ${row.slug}`);
}

await browser.close();
console.log(`\ngenerated=${generated} skipped=${skipped} failed=${failed}`);
console.log("NOTE: content status is NOT changed here. Publication remains a human decision.");
