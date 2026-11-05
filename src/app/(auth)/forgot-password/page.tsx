import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/password-forms";
import { Notice } from "@/components/ui";

export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  return (
    <div className="card">
      <h2>Forgot your password?</h2>
      <Notice code={notice} />
      <p className="muted">Enter the email you signed up with. We&apos;ll send you a link to choose a new password.</p>
      <ForgotPasswordForm />
      <p style={{ marginTop: "1.25rem" }}>
        <Link href="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
