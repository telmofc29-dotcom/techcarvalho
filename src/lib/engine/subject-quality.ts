// IS THIS SUBJECT USABLE AS AN ARTICLE TITLE AT ALL?
//
// This is the gate that was missing. Subject validity was being checked only
// AFTER drafting, by queue triage, so the same broken subject was re-drafted on
// every run — "When Apple announced its event" was removed by triage and
// recreated by the very next scan. A rule enforced only downstream of the thing
// that breaks it is not a rule.
//
// It is deliberately a SEPARATE question from importance. `classifyImportance`
// answers "is this development worth covering"; this answers "is this string a
// coherent subject for a headline". A major launch described by a sentence
// fragment fails here and should.
//
// Every pattern below comes from a subject that actually reached a live draft.

export type SubjectFlaw =
  | "opens_mid_sentence"
  | "dangling_end"
  | "bare_subject"
  | "first_person"
  | "too_short";

export type SubjectVerdict = {
  usable: boolean;
  flaw: SubjectFlaw | null;
  reason: string;
};

/**
 * A pronoun or subordinator at the start means the sentence began somewhere
 * else. These come from body text, not headlines.
 */
const OPENS_MID_SENTENCE =
  /^(it|its|they|their|them|he|she|this|that|these|those|when|while|after|before|because|although|though|which|who)\b/i;

/**
 * First person in a headline marks a column, not a report. TechCarvalho has no
 * "I" — publishing one would attribute another writer's personal experience to
 * this publication.
 */
const FIRST_PERSON = /\b(i|i'm|i’m|i am|i've|i’ve|i'll|my|me|mine|we tried|our review)\b/i;

/**
 * Trailing words that leave the phrase mid-thought. Kept in step with the
 * trimming in research-pipeline.ts, which fixes most of these before they
 * arrive; this catches subjects that came from elsewhere.
 */
const DANGLING_END =
  /\b(a|an|the|and|or|of|in|on|at|to|for|with|by|as|from|over|under|after|before|ahead|than|that|its|is|are|be|will|would|could|might|may|has|have|more|up|out|about|last|next|new|comes|gets|adds|brings|makes|takes|gives|uses|includes|features|offers|supports|better|worse|faster|cheaper)$/i;

/**
 * One or two capitalised words and nothing else: a company or product name with
 * no development attached. "Apple" is not a story.
 */
const BARE_SUBJECT = /^[A-Z][A-Za-z0-9'’+.-]*( [A-Z][A-Za-z0-9'’+.-]*)?$/;

export function assessSubject(subject: string): SubjectVerdict {
  const s = subject.trim();

  if (s.split(/\s+/).filter(Boolean).length < 2) {
    return { usable: false, flaw: "too_short", reason: "fewer than two words" };
  }
  if (OPENS_MID_SENTENCE.test(s)) {
    return {
      usable: false,
      flaw: "opens_mid_sentence",
      reason: "starts mid-sentence with an unresolved reference",
    };
  }
  if (FIRST_PERSON.test(s)) {
    return {
      usable: false,
      flaw: "first_person",
      reason: "written in the first person — a column, not a report",
    };
  }
  if (DANGLING_END.test(s)) {
    return { usable: false, flaw: "dangling_end", reason: "ends on a dangling word — truncated subject" };
  }
  if (BARE_SUBJECT.test(s)) {
    return { usable: false, flaw: "bare_subject", reason: "a company or product name, with no development" };
  }
  return { usable: true, flaw: null, reason: "" };
}
