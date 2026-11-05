import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PairForm } from "@/components/pair-form";
import { normalizeCode } from "@/lib/devices/pairing";
import { currentDevice } from "@/server/elder-context";

export const metadata: Metadata = { title: "Connect this device" };

export default async function PairPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  if (await currentDevice()) redirect("/home");
  const { code } = await searchParams;
  const prefill = typeof code === "string" ? normalizeCode(code) : null;

  return (
    <div className="elder-card elder-narrow">
      <h1 className="elder-title">Connect this device to DayMate</h1>
      <p className="elder-text">Your family member can see a pairing code on their own DayMate page, under &ldquo;Elder&apos;s device&rdquo;.</p>
      <PairForm code={prefill ?? undefined} />
    </div>
  );
}
