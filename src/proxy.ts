import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const { pathname } = request.nextUrl;
  const isAdminRoute = pathname.startsWith("/admin");
  // Password-recovery routes must stay reachable without a session — most
  // importantly /admin/forgot-password, which by definition is always
  // visited unauthenticated. Without this exclusion this guard would bounce
  // every visitor straight back to /admin/login before the page ever
  // rendered, and the reset flow could never be reached at all.
  // /admin/reset-password is included too even though it would often pass
  // anyway (the recovery session from /auth/confirm makes `user` truthy) —
  // excluding it lets that page's own "no session -> back to
  // forgot-password" redirect be the one that actually fires, instead of
  // this generic bounce to /admin/login, for a clearer failure message.
  const isPublicAuthRoute =
    pathname === "/admin/login" || pathname === "/admin/forgot-password" || pathname === "/admin/reset-password";

  // Defense-in-depth only: redirects unauthenticated visitors before
  // render. The real authorization boundary is requireAdmin() in
  // src/lib/dal.ts, called by every admin Server Component/Action.
  if (isAdminRoute && !isPublicAuthRoute && !user) {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
