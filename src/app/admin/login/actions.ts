"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SignInState = { error: string | null };

// Only ever redirect to a same-app admin path from this — never trust an
// arbitrary "next" value as a full URL, to avoid an open redirect.
function safeAdminRedirectTarget(next: FormDataEntryValue | null): string {
  if (typeof next !== "string" || !next.startsWith("/admin") || next.startsWith("//")) {
    return "/admin";
  }
  return next;
}

export async function signIn(
  _prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");
  const next = safeAdminRedirectTarget(formData.get("next"));

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Invalid email or password." };
  }

  redirect(next);
}
