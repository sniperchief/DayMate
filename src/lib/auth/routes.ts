/** Routes reachable without a session. Everything else requires login. */
export const PUBLIC_ROUTES = ["/login", "/register", "/auth/confirm"] as const;
/** Auth pages a signed-in caregiver should be bounced away from. */
const AUTH_PAGES = ["/login", "/register"];

export const HOME = "/dashboard";

function matches(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export type RouteDecision = { type: "allow" } | { type: "redirect"; to: string };

/** Pure access decision used by the proxy (and unit-tested). */
export function routeAccess(pathname: string, isAuthenticated: boolean): RouteDecision {
  const isPublic = PUBLIC_ROUTES.some((r) => matches(pathname, r));
  if (!isAuthenticated && !isPublic) {
    const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return { type: "redirect", to: `/login${next}` };
  }
  if (isAuthenticated && (pathname === "/" || AUTH_PAGES.some((r) => matches(pathname, r)))) {
    return { type: "redirect", to: HOME };
  }
  return { type: "allow" };
}

/** Only allow same-site relative redirects after login (no open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return HOME;
  return next;
}
