"use client";

import { loginAction, registerAction } from "@/app/(auth)/actions";
import { FormShell, Hidden, TextField } from "./form";

export function LoginForm({ next }: { next?: string }) {
  return (
    <FormShell action={loginAction} submitLabel="Sign in" pendingLabel="Signing in…">
      <TextField name="email" label="Email address" type="email" required autoComplete="email" />
      <TextField name="password" label="Password" type="password" required autoComplete="current-password" />
      <Hidden name="next" value={next ?? ""} />
    </FormShell>
  );
}

export function RegisterForm() {
  return (
    <FormShell action={registerAction} submitLabel="Create account" pendingLabel="Creating account…">
      <TextField name="display_name" label="Your name" maxLength={80} autoComplete="name" />
      <TextField name="email" label="Email address" type="email" required autoComplete="email" />
      <TextField name="password" label="Password" type="password" required autoComplete="new-password" hint="At least 8 characters." />
    </FormShell>
  );
}
