import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <div className="card">
      <h2>Create a caregiver account</h2>
      <p className="muted">You&apos;ll use this account to look after the details of the person you care for.</p>
      <RegisterForm />
      <p style={{ marginTop: "1.25rem" }}>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </div>
  );
}
