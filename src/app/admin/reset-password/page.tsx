import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

// Only reachable with the recovery session /auth/confirm establishes — a
// direct visit with no session (expired link, or never came from the
// email) redirects to the request page rather than showing a form that
// would just fail on submit. Deliberately checks for any authenticated
// user via getUser() rather than requireAdmin()/getCurrentAdmin() (which
// also requires an admin_users row) — resetting a password is a Supabase
// Auth concern, not an app-authorization one, and gating it on admin_users
// membership could block a legitimate reset for an account whose admin_users
// row provisioning hasn't happened yet.
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/forgot-password");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-xl font-semibold">Set a new password</h1>
      <ResetPasswordForm />
    </main>
  );
}
