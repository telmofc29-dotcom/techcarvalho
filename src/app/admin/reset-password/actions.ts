"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ResetPasswordState = { error: string | null };

const MIN_PASSWORD_LENGTH = 8;

export async function updatePassword(
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const password = formData.get("password");
  const confirmPassword = formData.get("confirmPassword");

  if (typeof password !== "string" || !password) {
    return { error: "A new password is required." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const supabase = await createClient();

  // Requires the recovery session established by /auth/confirm — if it's
  // missing or has expired since the page loaded, updateUser() itself
  // fails rather than silently succeeding for an unauthenticated caller.
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: "Couldn't update your password. The reset link may have expired — request a new one." };
  }

  // The recovery session from exchangeCodeForSession() is a real signed-in
  // session, so the admin is already authenticated — send them straight
  // into the dashboard rather than back through login.
  redirect("/admin");
}
