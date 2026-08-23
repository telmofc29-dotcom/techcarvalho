import "server-only";
import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";

// Is the contact backend actually there?
//
// WHY THIS EXISTS
// ---------------
// The contact form writes through submit_contact_message(), which arrives with
// supabase/migrations_pending/20260825_contact_messages.sql. Until that is
// applied, the form renders, a visitor types a message, presses send, and is
// told it could not be delivered.
//
// That is honest, and it is still worse than what it replaced. The page it
// replaced said plainly that there was no contact route yet — which is a
// limitation. A form that accepts a message and then fails is a broken feature,
// and Google's Publisher Policies care about the difference. So does anyone who
// just spent five minutes writing to us.
//
// So the page ASKS whether the backend exists and renders the form only if it
// does. Deploying the code and applying the migration then become independent
// events in either order, which is the only safe property when one of them is a
// git push and the other is a person pasting SQL into a browser at some later
// point.
//
// HOW IT ASKS
// -----------
// By calling the RPC with a deliberately invalid payload. A missing function
// returns PGRST202 (or 42883); a present one rejects the payload on its own
// validation and returns something else. Either way NOTHING IS WRITTEN — the
// probe cannot create a message, because the values it sends are ones the
// function is built to refuse.
//
// Checking information_schema would be cleaner in principle and is not
// available to this client. Probing the real entry point has a compensating
// advantage: it tests what the form will actually do, including the grant, not
// merely whether a row exists in a catalogue.

/** Cached for the lifetime of the render. */
export type ContactAvailability = {
  available: boolean;
  /** For the admin/debug surface. Never shown to a visitor. */
  detail: string;
};

const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883", "42P01"]);

export async function getContactAvailability(): Promise<ContactAvailability> {
  const supabase = await createClient();

  // Every value here is one submit_contact_message() validates and rejects:
  // an empty subject is not in its allow-list, and an empty message is far
  // below the minimum length. It cannot succeed, so it cannot write.
  const { error } = await supabase.rpc("submit_contact_message", {
    p_name: "",
    p_email: "",
    p_subject: "",
    p_message: "",
  });

  if (!error) {
    // The function exists and — unexpectedly — accepted that payload. Treat the
    // backend as present, but say so loudly: a function that accepts an empty
    // message is a validation bug worth seeing in the logs.
    logQueryError(
      "contact.availability",
      { message: "submit_contact_message accepted an empty probe payload; its validation may be wrong" }
    );
    return { available: true, detail: "rpc present (probe unexpectedly accepted)" };
  }

  if (MISSING_FUNCTION_CODES.has(error.code ?? "")) {
    return { available: false, detail: `not installed (${error.code})` };
  }

  // Any other error is the function rejecting the probe, which is exactly what
  // a working installation does.
  return { available: true, detail: `rpc present (rejected probe: ${error.code ?? "no code"})` };
}
