import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AdminUser = {
  id: string;
  email: string | null;
  display_name: string | null;
};

// Cached per-request: safe to call getCurrentAdmin() from multiple
// Server Components/Actions without refetching. Uses getUser(), which
// revalidates the session against Supabase, rather than getSession(),
// which only trusts the (spoofable) cookie.
export const getCurrentAdmin = cache(async (): Promise<AdminUser | null> => {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const { data: admin, error: adminError } = await supabase
    .from("admin_users")
    .select("id, display_name")
    .eq("id", user.id)
    .single();

  if (adminError || !admin) {
    return null;
  }

  return {
    id: admin.id,
    email: user.email ?? null,
    display_name: admin.display_name,
  };
});

// The true authorization boundary for admin routes/actions. proxy.ts only
// provides a defense-in-depth redirect; every admin Server
// Component/Action must call this (or getCurrentAdmin) directly.
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getCurrentAdmin();

  if (!admin) {
    redirect("/admin/login");
  }

  return admin;
}
