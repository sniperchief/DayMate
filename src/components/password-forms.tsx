"use client";

import { forgotPasswordAction, resetPasswordAction } from "@/app/(auth)/password-actions";
import { FormShell, TextField } from "./form";

export function ForgotPasswordForm() {
  return (
    <FormShell action={forgotPasswordAction} submitLabel="Send reset link" pendingLabel="Sending…">
      <TextField name="email" label="Email address" type="email" required autoComplete="email" />
    </FormShell>
  );
}

export function ResetPasswordForm() {
  return (
    <FormShell action={resetPasswordAction} submitLabel="Save new password" pendingLabel="Saving…">
      <TextField name="password" label="New password" type="password" required autoComplete="new-password" hint="At least 8 characters." />
      <TextField name="confirm_password" label="Type it again" type="password" required autoComplete="new-password" />
    </FormShell>
  );
}
