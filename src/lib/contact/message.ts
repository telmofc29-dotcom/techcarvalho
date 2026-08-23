// The contact form's rules, as data and pure functions.
//
// Kept out of the Server Action so they can be tested without a database and
// so the browser and the server enforce the SAME limits rather than two
// approximations of them. The database enforces them a third time
// (submit_contact_message() in supabase/migrations_pending/20260825_contact_messages.sql)
// — deliberately, because a Server Action is reachable by direct POST and the
// browser's `required`/`maxlength` attributes are decoration.
//
// Keep the vocabularies and the numbers here in sync with that migration's
// CHECK constraints. The migration is the source of truth; this file is what
// the reader is told.

export const CONTACT_SUBJECTS = [
  { value: "correction", label: "A correction to something published" },
  { value: "sourcing", label: "A question about a source or a claim" },
  { value: "permissions", label: "Permissions, licensing, or image reuse" },
  { value: "general", label: "Something else" },
] as const;

export type ContactSubject = (typeof CONTACT_SUBJECTS)[number]["value"];

export const CONTACT_SUBJECT_VALUES: readonly ContactSubject[] = CONTACT_SUBJECTS.map((s) => s.value);

/** Below this a "message" is not one, and it is what bots submit. */
export const MESSAGE_MIN_LENGTH = 20;
export const MESSAGE_MAX_LENGTH = 4000;
export const NAME_MAX_LENGTH = 120;
export const EMAIL_MAX_LENGTH = 254;

/**
 * The honeypot field's name.
 *
 * It is a real, labelled field hidden with CSS — NOT aria-hidden and not
 * `type="hidden"`. A screen-reader user reaches it and is told to leave it
 * empty, and if they fill it in anyway they are told plainly that the message
 * was not sent. The usual trick (silently discard, report success) is a lie to
 * anybody it misfires on, and it misfires exactly on the people least able to
 * tell it did.
 */
export const HONEYPOT_FIELD = "website";

export type ContactFailureReason =
  | "invalid_email"
  | "invalid_subject"
  | "invalid_message"
  | "invalid_name"
  | "honeypot"
  | "rate_limited_sender"
  | "rate_limited_site"
  | "storage_unavailable"
  | "unknown";

export type ContactDraft = {
  name: string;
  email: string;
  subject: string;
  message: string;
  pagePath: string;
  honeypot: string;
};

export type ContactSubmission = {
  name: string | null;
  email: string;
  subject: ContactSubject;
  message: string;
  pagePath: string | null;
};

export type ContactValidation =
  | { ok: true; value: ContactSubmission }
  | { ok: false; reason: ContactFailureReason };

// Same shape as the database's own check, and for the same reason: an
// over-clever address grammar rejects real addresses. All this has to
// establish is that there is something a reply could be sent to.
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Only ever a same-site path, never an absolute URL a caller could supply. */
function normalisePagePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  return trimmed.slice(0, 512);
}

export function validateContactDraft(draft: ContactDraft): ContactValidation {
  if (draft.honeypot.trim() !== "") return { ok: false, reason: "honeypot" };

  const name = draft.name.trim();
  if (name.length > NAME_MAX_LENGTH) return { ok: false, reason: "invalid_name" };

  const email = draft.email.trim().toLowerCase();
  if (email.length < 6 || email.length > EMAIL_MAX_LENGTH || !EMAIL_SHAPE.test(email)) {
    return { ok: false, reason: "invalid_email" };
  }

  const subject = draft.subject.trim();
  if (!CONTACT_SUBJECT_VALUES.includes(subject as ContactSubject)) {
    return { ok: false, reason: "invalid_subject" };
  }

  const message = draft.message.trim();
  if (message.length < MESSAGE_MIN_LENGTH || message.length > MESSAGE_MAX_LENGTH) {
    return { ok: false, reason: "invalid_message" };
  }

  return {
    ok: true,
    value: {
      name: name === "" ? null : name,
      email,
      subject: subject as ContactSubject,
      message,
      pagePath: normalisePagePath(draft.pagePath),
    },
  };
}

/**
 * What the sender is told.
 *
 * Every branch says what happened and, where there is one, what to do about
 * it. "Something went wrong" is not on the list: a message that vanished with
 * no explanation is indistinguishable from one that was ignored.
 */
export function contactFailureMessage(reason: ContactFailureReason): string {
  switch (reason) {
    case "invalid_email":
      return "That email address doesn't look right. It's the only way to reply to you, so it has to be one that works.";
    case "invalid_subject":
      return "Pick one of the listed reasons for getting in touch.";
    case "invalid_message":
      return `Messages need to be between ${MESSAGE_MIN_LENGTH} and ${MESSAGE_MAX_LENGTH} characters.`;
    case "invalid_name":
      return `A name can be at most ${NAME_MAX_LENGTH} characters.`;
    case "honeypot":
      return "This message was not sent: the field labelled “Leave this field empty” was filled in. It is there to catch automated submissions. Clear it and send again.";
    case "rate_limited_sender":
      return "That address has already sent three messages in the last hour. Try again later — the earlier ones have not been lost.";
    case "rate_limited_site":
      return "The contact form has hit its hourly limit and is not accepting messages for now. Please try again later.";
    case "storage_unavailable":
      return "The message could not be saved, so it has not been sent. This is a fault at our end, not a problem with what you wrote. Please try again later.";
    case "unknown":
      return "The message was not sent. Please try again.";
  }
}
