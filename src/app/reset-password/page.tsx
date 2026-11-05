import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/password-forms";
import { getUserId } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a new password" };

/** Reached from the reset email via /auth/confirm, which has just signed the caregiver in. */
export default async function ResetPasswordPage() {
  if (!(await getUserId())) redirect("/forgot-password?notice=link-expired");
  return (
    <main id="main" className="auth-wrap">
      <div className="auth-brand">
        <h1>DayMate</h1>
        <p>A little help remembering what matters.</p>
      </div>
      <div className="card">
        <h2>Choose a new password</h2>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
