import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isElderRoute, routeAccess } from "./lib/auth/routes";
import { DEVICE_COOKIE, deviceCookieOptions, isWellFormedToken } from "./lib/devices/cookie";
import { publicSupabaseEnv } from "./lib/supabase/env";

/**
 * Refreshes the Supabase session cookie on every request and guards
 * protected routes. Pages and Server Functions re-verify the user as well;
 * this is not the only access check (RLS enforces data access).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = publicSupabaseEnv();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();

  // Elder devices: always allowed (each elder page checks the paired-device
  // cookie, or a caregiver's read-only preview). Keep the pairing cookie alive;
  // browsers cap cookie lifetime at 400 days.
  if (isElderRoute(request.nextUrl.pathname)) {
    const token = request.cookies.get(DEVICE_COOKIE)?.value;
    if (isWellFormedToken(token)) response.cookies.set(DEVICE_COOKIE, token, deviceCookieOptions());
    return response;
  }

  const decision = routeAccess(request.nextUrl.pathname, Boolean(data?.claims?.sub));

  if (decision.type === "redirect") {
    const redirect = NextResponse.redirect(new URL(decision.to, request.url));
    // carry refreshed auth cookies across the redirect
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

