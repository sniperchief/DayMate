"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/domain/types";
import { forgotPasswordSchema, formValues, newPasswordSchema, parseForm } from "@/lib/domain/validation";
import { createClient } from "@/lib/supabase/server";

/**
 * Password reset. The reset email links to /auth/confirm, which signs the
 * caregiver in for this one purpose and forwards to /reset-password.
 */

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

// Same reply whether or not the address has an account, so the form can't be
// used to find out who is registered.
const SENT = "If there's a DayMate account for that email, we've sent a link to choose a new password. It can take a few minutes — check your spam folder too.";

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const parsed = parseForm(forgotPasswordSchema, values);
  if (!parsed.ok) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: parsed.fieldErrors, values, nonce: randomUUID() };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await origin()}/auth/confirm?next=/reset-password`,
  });
  if (error) {
    console.error(`[daymate] password reset email failed: ${error.status ?? ""} ${error.code ?? ""} ${error.message}`);
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      return { status: "error", message: "Too many emails have been sent recently. Please wait a little while and try again.", values, nonce: randomUUID() };
    }
  }
  return { status: "success", message: SENT, nonce: randomUUID() };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const parsed = parseForm(newPasswordSchema, values);
  // never echo passwords back
  if (!parsed.ok) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: parsed.fieldErrors, nonce: randomUUID() };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/forgot-password?notice=link-expired");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error(`[daymate] password update failed: ${error.status ?? ""} ${error.code ?? ""} ${error.message}`);
    const same = error.code === "same_password";
    const weak = error.code === "weak_password";
    return {
      status: "error",
      message: same ? "That's your current password. Please choose a different one." : weak ? error.message : "We couldn't change your password. Please try again.",
      fieldErrors: same || weak ? { password: same ? "Choose a different password." : error.message } : undefined,
      nonce: randomUUID(),
    };
  }
  redirect("/dashboard?notice=password-updated");
}
