// Password reset validation — pure, no network.
import { describe, expect, it } from "vitest";
import { forgotPasswordSchema, newPasswordSchema, parseForm } from "../../src/lib/domain/validation";

describe("forgot / reset password validation", () => {
  it("needs a valid email to request a reset", () => {
    expect(parseForm(forgotPasswordSchema, { email: " Rose@Example.com " })).toEqual({ ok: true, data: { email: "rose@example.com" } });
    expect(parseForm(forgotPasswordSchema, { email: "not-an-email" })).toMatchObject({ ok: false, fieldErrors: { email: expect.any(String) } });
  });

  it("new password: at least 8 characters and typed the same twice", () => {
    expect(parseForm(newPasswordSchema, { password: "longenough", confirm_password: "longenough" }).ok).toBe(true);
    expect(parseForm(newPasswordSchema, { password: "short", confirm_password: "short" })).toMatchObject({ ok: false, fieldErrors: { password: expect.stringContaining("8") } });
    expect(parseForm(newPasswordSchema, { password: "longenough", confirm_password: "different1" })).toMatchObject({ ok: false, fieldErrors: { confirm_password: "The two passwords don't match." } });
  });
});
