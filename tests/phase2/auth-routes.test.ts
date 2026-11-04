import { describe, expect, it } from "vitest";
import { routeAccess, safeNext } from "../../src/lib/auth/routes";

describe("routeAccess (proxy route guard)", () => {
  it.each(["/dashboard", "/profile", "/family", "/family/abc", "/routines", "/memories/x"])("redirects signed-out visitors away from %s", (path) => {
    expect(routeAccess(path, false)).toEqual({ type: "redirect", to: `/login?next=${encodeURIComponent(path)}` });
  });

  it("sends signed-out visitors at / to plain /login", () => {
    expect(routeAccess("/", false)).toEqual({ type: "redirect", to: "/login" });
  });

  it.each(["/login", "/register", "/auth/confirm"])("allows signed-out access to %s", (path) => {
    expect(routeAccess(path, false)).toEqual({ type: "allow" });
  });

  it("does not treat look-alike paths as public", () => {
    expect(routeAccess("/login-admin", false).type).toBe("redirect");
    expect(routeAccess("/registerx", false).type).toBe("redirect");
  });

  it("allows signed-in caregivers into the app", () => {
    expect(routeAccess("/dashboard", true)).toEqual({ type: "allow" });
    expect(routeAccess("/memories/123", true)).toEqual({ type: "allow" });
  });

  it("bounces signed-in caregivers from auth pages to the dashboard", () => {
    expect(routeAccess("/login", true)).toEqual({ type: "redirect", to: "/dashboard" });
    expect(routeAccess("/register", true)).toEqual({ type: "redirect", to: "/dashboard" });
    expect(routeAccess("/", true)).toEqual({ type: "redirect", to: "/dashboard" });
  });

  it("still lets signed-in users complete email confirmation", () => {
    expect(routeAccess("/auth/confirm", true)).toEqual({ type: "allow" });
  });
});

describe("safeNext (post-login redirect)", () => {
  it("keeps same-site relative paths", () => {
    expect(safeNext("/family")).toBe("/family");
  });
  it.each([null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"])("rejects %s", (v) => {
    expect(safeNext(v)).toBe("/dashboard");
  });
});
