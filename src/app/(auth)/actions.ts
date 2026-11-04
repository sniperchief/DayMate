"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/routes";
import type { FormState } from "@/lib/domain/types";
import { credentialsSchema, formValues, parseForm, registerSchema } from "@/lib/domain/validation";
import { createClient } from "@/lib/supabase/server";

function error(message: string, values: Record<string, string>, fieldErrors?: Record<string, string>): FormState {
  // never echo the password back to the client
  const { password: _omit, ...safe } = values;
  return { status: "error", message, fieldErrors, values: safe, nonce: randomUUID() };
}

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const parsed = parseForm(credentialsSchema, values);
  if (!parsed.ok) return error("Please check the highlighted fields.", values, parsed.fieldErrors);

  const supabase = await createClient();
  const { error: authError } = await supabase.auth.signInWithPassword(parsed.data);
  if (authError) {
    const unconfirmed = /confirm/i.test(authError.message);
    return error(unconfirmed ? "Please confirm your email address first — check your inbox." : "That email and password don't match. Please try again.", values);
  }
  redirect(safeNext(values.next));
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const parsed = parseForm(registerSchema, values);
  if (!parsed.ok) return error("Please check the highlighted fields.", values, parsed.fieldErrors);

  const supabase = await createClient();
  const { data, error: authError } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.display_name },
      emailRedirectTo: `${await origin()}/auth/confirm?next=/profile`,
    },
  });
  if (authError) {
    console.error(`[daymate] sign-up failed: ${authError.status ?? ""} ${authError.code ?? ""} ${authError.message}`);
    if (authError.status === 429 || authError.code === "over_email_send_rate_limit") {
      return error("Too many sign-up emails have been sent recently. Please wait a little while and try again.", values);
    }
    const weak = authError.code === "weak_password" || /password/i.test(authError.message);
    return error(weak ? authError.message : "We couldn't create your account. Please try again.", values, weak ? { password: authError.message } : undefined);
  }
  if (data.session) redirect("/profile");
  return {
    status: "success",
    message: "Account created. We've sent you an email — open the link in it to confirm your address, then sign in.",
    nonce: randomUUID(),
  };
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
