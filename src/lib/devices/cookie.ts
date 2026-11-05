/** Paired-device cookie settings (no Node-only imports: also used by the proxy). */
export const DEVICE_COOKIE = "daymate_device";
/** Browsers cap cookie lifetime at 400 days; the proxy refreshes it on use. */
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedToken(token: string | undefined | null): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export function deviceCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: DEVICE_COOKIE_MAX_AGE };
}
