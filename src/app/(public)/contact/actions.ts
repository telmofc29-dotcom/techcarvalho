"use server";

import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import {
  validateContactDraft,
  contactFailureMessage,
  HONEYPOT_FIELD,
  type ContactFailureReason,
} from "@/lib/contact/message";

// The state useActionState carries between renders.
//
// `values` exists so a rejected message is not also a lost one: React resets
// an uncontrolled form after an action runs, so without echoing what was typed
// back into defaultValue, a validation error would silently wipe a long
// correction somebody spent ten minutes writing.
export type ContactFormState = {
  status: "idle" | "sent" | "error";
  message: string;
  reason?: ContactFailureReason;
  values?: { name: string; email: string; subject: string; message: string };
};

export const CONTACT_INITIAL_STATE: ContactFormState = { status: "idle", message: "" };

function failure(reason: ContactFailureReason, values: ContactFormState["values"]): ContactFormState {
  return { status: "error", message: contactFailureMessage(reason), reason, values };
}

/**
 * The contact form's Server Action.
 *
 * There is no auth check here on purpose — this is the one write path on the
 * site an anonymous visitor is *meant* to use. What stands in for auth:
 *
 *  - validateContactDraft() runs server-side, because a Server Action is
 *    reachable by direct POST and the form's own attributes are decoration.
 *  - The insert goes through public.submit_contact_message(), a SECURITY
 *    DEFINER function that validates a second time and rate-limits. `anon` has
 *    no privilege on contact_messages at all, so there is no path from here to
 *    the table except through that function's rules.
 *
 * See supabase/migrations_pending/20260825_contact_messages.sql.
 */
export async function submitContactMessage(
  _previous: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  const draft = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    subject: String(formData.get("subject") ?? ""),
    message: String(formData.get("message") ?? ""),
    pagePath: String(formData.get("page_path") ?? ""),
    honeypot: String(formData.get(HONEYPOT_FIELD) ?? ""),
  };
  const echo = {
    name: draft.name,
    email: draft.email,
    subject: draft.subject,
    message: draft.message,
  };

  const validated = validateContactDraft(draft);
  if (!validated.ok) return failure(validated.reason, echo);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_contact_message", {
    p_name: validated.value.name,
    p_email: validated.value.email,
    p_subject: validated.value.subject,
    p_message: validated.value.message,
    p_page_path: validated.value.pagePath,
  });

  // An empty result and a failed one must never look the same — the rule this
  // project wrote down after every public page spent weeks rendering an honest
  // empty state over a broken query. Applied to a form, it means: if the write
  // did not happen, the sender is told it did not happen. Never "Thanks!".
  if (error) {
    logQueryError("submitContactMessage rpc", error);
    return failure("storage_unavailable", echo);
  }

  const result = data as { ok?: boolean; reason?: string } | null;
  if (!result || result.ok !== true) {
    const reason = (result?.reason ?? "unknown") as ContactFailureReason;
    // A reason the database knows about but this build does not is still a
    // refusal — report it as one rather than treating it as success.
    return failure(reason, echo);
  }

  return {
    status: "sent",
    message:
      "Message received. It is stored where the publisher will read it. There is no automatic reply, and no guaranteed response time — this is a one-person publication.",
  };
}
