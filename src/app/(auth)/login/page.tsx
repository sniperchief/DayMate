import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth-forms";
import { Notice } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; notice?: string }> }) {
  const { next, notice } = await searchParams;
  return (
    <div className="card">
      <h2>Sign in</h2>
      <Notice code={notice} />
      <LoginForm next={next} />
      <p style={{ marginTop: "1.25rem" }}>
        New to DayMate? <Link href="/register">Create a caregiver account</Link>
      </p>
    </div>
  );
}
