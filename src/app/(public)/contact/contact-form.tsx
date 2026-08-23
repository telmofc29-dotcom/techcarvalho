"use client";

import { useActionState } from "react";
import { usePathname } from "next/navigation";
import { submitContactMessage, CONTACT_INITIAL_STATE } from "./actions";
import {
  CONTACT_SUBJECTS,
  HONEYPOT_FIELD,
  MESSAGE_MAX_LENGTH,
  MESSAGE_MIN_LENGTH,
  NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
} from "@/lib/contact/message";

const FIELD =
  "w-full rounded-lg border border-border-subtle bg-white px-4 py-3 text-base text-zinc-900 shadow-sm " +
  "focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50";
const LABEL = "text-sm font-medium text-zinc-800";
const HINT = "text-xs text-zinc-500";

export function ContactForm() {
  const [state, formAction, pending] = useActionState(submitContactMessage, CONTACT_INITIAL_STATE);
  // Which page the sender came from, when they arrived from an article. Read
  // from the router rather than a hidden value the page hard-codes, and
  // re-checked server-side (it is dropped unless it is a same-site path).
  const pathname = usePathname();

  if (state.status === "sent") {
    return (
      <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-5">
        <p className="text-base font-medium text-green-900">Sent</p>
        <p className="mt-1 text-sm leading-relaxed text-green-800">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="page_path" value={pathname ?? ""} />

      {state.status === "error" && (
        // role="alert" so it is announced. It says what went wrong and never
        // implies the message was sent.
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-900">
          {state.message}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-name" className={LABEL}>
          Your name <span className="font-normal text-zinc-500">(optional)</span>
        </label>
        <input
          id="contact-name"
          name="name"
          type="text"
          maxLength={NAME_MAX_LENGTH}
          autoComplete="name"
          defaultValue={state.values?.name ?? ""}
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-email" className={LABEL}>
          Your email
        </label>
        <input
          id="contact-email"
          name="email"
          type="email"
          required
          maxLength={EMAIL_MAX_LENGTH}
          autoComplete="email"
          defaultValue={state.values?.email ?? ""}
          aria-describedby="contact-email-hint"
          className={FIELD}
        />
        <p id="contact-email-hint" className={HINT}>
          Used only to reply to you. It is never published, never added to a mailing list, and never
          shared.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-subject" className={LABEL}>
          What is this about?
        </label>
        <select
          id="contact-subject"
          name="subject"
          required
          defaultValue={state.values?.subject ?? "correction"}
          className={`${FIELD} min-h-11`}
        >
          {CONTACT_SUBJECTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact-message" className={LABEL}>
          Message
        </label>
        <textarea
          id="contact-message"
          name="message"
          required
          rows={7}
          minLength={MESSAGE_MIN_LENGTH}
          maxLength={MESSAGE_MAX_LENGTH}
          defaultValue={state.values?.message ?? ""}
          aria-describedby="contact-message-hint"
          className={FIELD}
        />
        <p id="contact-message-hint" className={HINT}>
          For a correction, the page and the sentence you mean is the most useful thing you can
          include.
        </p>
      </div>

      {/* Honeypot. Hidden with CSS that keeps it in the accessibility tree, and
          labelled, so a screen-reader user is told to leave it alone rather
          than filling in an invisible trap. If it is filled in the form says so
          plainly instead of pretending to have sent the message — see
          HONEYPOT_FIELD in src/lib/contact/message.ts. */}
      <div className="absolute left-[-9999px] h-px w-px overflow-hidden">
        <label htmlFor="contact-website">Leave this field empty</label>
        <input id="contact-website" name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-accent px-6 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {pending ? "Sending..." : "Send message"}
        </button>
      </div>
    </form>
  );
}
