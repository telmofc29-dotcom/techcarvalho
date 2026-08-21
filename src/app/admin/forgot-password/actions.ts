"use server";

import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/seo/site";

export type ForgotPasswordState = { submitted: boolean };

// Always returns the same { submitted: true } result regardless of whether
// the email actually matches an admin account, or whether Supabase's own
// call errors — resetPasswordForEmail() itself doesn't leak whether an
// email exists (it resolves the same way either way for unknown emails),
// and this action preserves that anti-enumeration property rather than
// surfacing a different message/error state an attacker could use to probe
// which emails have accounts.
export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = formData.get("email");

  if (typeof email === "string" && email) {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: absoluteUrl("/auth/confirm"),
    });
  }

  return { submitted: true };
}
