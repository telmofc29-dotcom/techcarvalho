// OWNER QUEUE TRIAGE — classify every pending decision, remove only the ones
// that are objectively not decisions at all.
//
// The queue reached 114 items partly through genuine work and partly through
// three bugs that have since been fixed: a subject-phrase truncation that
// produced half-sentences, an importance classifier that let opinion columns
// and other outlets' reviews through, and a hedge-stripping regex that never
// ran. Items created by those bugs are not editorial decisions the owner should
// have to make — they are artefacts.
//
// WHAT THIS WILL AND WILL NOT DELETE
// ----------------------------------
// Removes only what can be shown to be invalid from the item itself:
//   - a title that is a sentence fragment or starts with an unresolved pronoun
//   - an opinion column or another publication's review
//   - a bare company name as the entire subject
//   - an exact-or-near duplicate of another queue item (the weaker copy goes)
//   - an item whose subject is already a PUBLISHED article
//
// Everything else is kept. A thin-but-real development is an editorial
// judgement and stays for the owner to make. When in doubt this keeps.
//
// Nothing is ever published, and no published article is touched.
//
//   npx tsx scripts/triage-owner-queue.ts            (report)
//   npx tsx scripts/triage-owner-queue.ts --apply    (remove the invalid ones)

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { classifyImportance } from "../src/lib/engine/priority-entities.ts";
import { titleSimilarity } from "../src/lib/engine/dedupe.ts";
import { assessSubject } from "../src/lib/engine/subject-quality.ts";

const apply = process.argv.includes("--apply");

/** Near-identical subjects. Deliberately high: merging two real stories is worse. */
const DUPLICATE_THRESHOLD = 0.72;

type Verdict =
  | "keep"
  | "fragment"
  | "opinion_or_review"
  | "generic_subject"
  | "duplicate"
  | "not_our_subject"
  | "already_published";

type Item = {
  kind: "draft" | "brief";
  id: string;
  title: string;
  subject: string;
  verdict: Verdict;
  detail: string;
};

const SUFFIX = ": what has been reported so far";

/** The part of the title that names the story, without the template tail. */
function subjectOf(title: string): string {
  return title.replace(SUFFIX, "").trim();
}

// COMPARISON TITLES DEFEAT WORD-OVERLAP SIMILARITY.
//
// "Canon EOS 6D vs Canon EOS 6D Mark II" and "Canon EOS 60D vs Canon EOS 6D
// Mark II" share almost every word and score as duplicates, but they compare
// different cameras and are different articles. Treating them as duplicates
// would delete real work on a scoring artefact.
//
// For an "X vs Y" subject the identity is the SET of things compared, not the
// words. Two comparisons are the same only when that set is the same.
function comparisonSides(subject: string): string[] | null {
  const parts = subject.split(/\s+vs\.?\s+/i);
  if (parts.length < 2) return null;
  return parts.map((p) => p.toLowerCase().replace(/[^a-z0-9]/g, "")).sort();
}

function sameStory(a: string, b: string): boolean {
  const sa = comparisonSides(a);
  const sb = comparisonSides(b);
  // One is a comparison and the other is not: different kinds of article.
  if ((sa === null) !== (sb === null)) return false;
  if (sa && sb) {
    return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
  }
  return titleSimilarity(a, b) >= DUPLICATE_THRESHOLD;
}

function classify(subject: string): { verdict: Verdict; detail: string } {
  const imp = classifyImportance(subject);
  if (imp.importance === "trivial" && /opinion|review|hands|i tried|i tested|why i/i.test(subject)) {
    return { verdict: "opinion_or_review", detail: "opinion column or another outlet's review" };
  }
  // Triage and the drafting scanner MUST share one definition of a usable
  // subject. While they differed, triage removed a broken subject and the very
  // next scan recreated it.
  // Anything the engine would refuse to draft TODAY should not be sitting in
  // the queue from a run before that rule existed. Matched on the specific
  // reason rather than on "routine" generally: a thin-but-real development is
  // an editorial judgement and stays for the owner to make.
  if (
    /outside the subjects this publication covers/.test(imp.reason) ||
    /Corporate, financial or personnel news/.test(imp.reason)
  ) {
    return { verdict: "not_our_subject", detail: imp.reason };
  }
  const q = assessSubject(subject);
  if (!q.usable) {
    const verdict: Verdict =
      q.flaw === "bare_subject" ? "generic_subject"
        : q.flaw === "first_person" ? "opinion_or_review"
          : "fragment";
    return { verdict, detail: q.reason };
  }
  return { verdict: "keep", detail: "" };
}

async function main(): Promise<void> {
  loadEnvLocal();
  const db = await createAdminClient();

  const [draftsRes, briefsRes, publishedRes] = await Promise.all([
    db.from("content_items").select("id, title").eq("status", "draft"),
    db.from("engine_briefs").select("id, proposed_title, review_state, assembled_content_id"),
    db.from("content_items").select("id, title").eq("status", "published"),
  ]);
  for (const [name, res] of [["drafts", draftsRes], ["briefs", briefsRes], ["published", publishedRes]] as const) {
    if (res.error) throw new Error(`${name} query failed: ${res.error.message}`);
  }

  const published = ((publishedRes.data ?? []) as { title: string }[]).map((p) => p.title);

  const items: Item[] = [];
  for (const d of (draftsRes.data ?? []) as { id: string; title: string }[]) {
    const subject = subjectOf(d.title);
    const { verdict, detail } = classify(subject);
    items.push({ kind: "draft", id: d.id, title: d.title, subject, verdict, detail });
  }
  // Only briefs with no draft attached are their own decision. One that already
  // produced a draft is represented by that draft and must not be judged twice.
  for (const b of (briefsRes.data ?? []) as {
    id: string; proposed_title: string; review_state: string; assembled_content_id: string | null;
  }[]) {
    if (b.assembled_content_id) continue;
    if (b.review_state === "rejected") continue;
    const subject = subjectOf(b.proposed_title);
    const { verdict, detail } = classify(subject);
    items.push({ kind: "brief", id: b.id, title: b.proposed_title, subject, verdict, detail });
  }

  const startingCount = items.length;

  // ---- already covered by a published article ----------------------------
  for (const it of items) {
    if (it.verdict !== "keep") continue;
    const hit = published.find((p) => sameStory(it.subject, p));
    if (hit) {
      it.verdict = "already_published";
      it.detail = `already published as "${hit.slice(0, 52)}"`;
    }
  }

  // ---- duplicates within the queue ---------------------------------------
  //
  // A draft outranks a brief for the same story: the draft is further along and
  // carries the research. Between two of a kind, the longer subject is the more
  // specific one and survives.
  const survivors: Item[] = [];
  for (const it of items) {
    if (it.verdict !== "keep") continue;
    const clash = survivors.find((s) => sameStory(s.subject, it.subject));
    if (!clash) { survivors.push(it); continue; }
    const incomingWins =
      (it.kind === "draft" && clash.kind === "brief") ||
      (it.kind === clash.kind && it.subject.length > clash.subject.length);
    const loser = incomingWins ? clash : it;
    const winner = incomingWins ? it : clash;
    loser.verdict = "duplicate";
    loser.detail = `same story as ${winner.kind} "${winner.subject.slice(0, 46)}"`;
    if (incomingWins) survivors[survivors.indexOf(clash)] = it;
  }

  // ---- report -------------------------------------------------------------
  const byVerdict = new Map<Verdict, Item[]>();
  for (const it of items) {
    if (!byVerdict.has(it.verdict)) byVerdict.set(it.verdict, []);
    byVerdict.get(it.verdict)!.push(it);
  }

  console.log(`\n${"=".repeat(78)}\nOWNER QUEUE TRIAGE  ${apply ? "(APPLYING)" : "(report)"}\n${"=".repeat(78)}`);
  console.log(`\n  starting decisions: ${startingCount}  (${items.filter((i) => i.kind === "draft").length} drafts, ${items.filter((i) => i.kind === "brief").length} unbuilt briefs)\n`);

  for (const v of ["fragment", "opinion_or_review", "generic_subject", "not_our_subject", "duplicate", "already_published"] as Verdict[]) {
    const list = byVerdict.get(v) ?? [];
    console.log(`  ${v.padEnd(19)} ${String(list.length).padStart(3)}`);
    for (const it of list.slice(0, 6)) {
      console.log(`      [${it.kind}] ${it.subject.slice(0, 56)}`);
      console.log(`             ${it.detail}`);
    }
    if (list.length > 6) console.log(`      ... and ${list.length - 6} more`);
  }

  const keep = byVerdict.get("keep") ?? [];
  console.log(`\n  ${"KEEP (genuine decisions)".padEnd(19)} ${String(keep.length).padStart(3)}`);

  if (!apply) {
    console.log("\n  REPORT ONLY — re-run with --apply to remove the invalid items.");
    return;
  }

  // ---- removal ------------------------------------------------------------
  let removedDrafts = 0, removedBriefs = 0;
  for (const it of items) {
    if (it.verdict === "keep") continue;
    if (it.kind === "draft") {
      // Detach the brief first so it is not left pointing at a deleted row.
      await db.from("engine_briefs").update({ assembled_content_id: null }).eq("assembled_content_id", it.id);
      const { error } = await db.from("content_items").delete().eq("id", it.id);
      if (error) console.error(`    draft delete failed: ${error.message}`);
      else removedDrafts++;
    } else {
      // A brief is rejected with its reason, not deleted: the record of what
      // was considered and why it was dropped is worth keeping.
      const { error } = await db
        .from("engine_briefs")
        .update({ review_state: "rejected", state: "rejected", state_reason: `triage: ${it.detail}` })
        .eq("id", it.id);
      if (error) console.error(`    brief reject failed: ${error.message}`);
      else removedBriefs++;
    }
  }
  console.log(`\n  removed ${removedDrafts} draft(s); rejected ${removedBriefs} brief(s) with a recorded reason.`);
  console.log(`  remaining genuine decisions: ${keep.length}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
