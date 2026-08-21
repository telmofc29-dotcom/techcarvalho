import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Receives the redirect from a Supabase password-recovery email. This
// project's Supabase clients (@supabase/ssr createBrowserClient/
// createServerClient) default to flowType: "pkce", so resetPasswordForEmail
// sends the user back here with a single-use ?code= query param rather than
// an implicit #access_token fragment — exchangeCodeForSession() turns that
// into a real session, written via the server client's cookie adapter, so
// /admin/reset-password can see an authenticated user afterward.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/admin/reset-password`);
    }
  }

  // Missing or invalid/expired code — send back to the request form rather
  // than showing a broken reset-password page with no session.
  return NextResponse.redirect(`${origin}/admin/forgot-password`);
}
