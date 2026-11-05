import type { Metadata } from "next";
import { firstName } from "@/server/page-data";
import { requireElderSession } from "@/server/elder-context";

export const metadata: Metadata = { title: "Home" };

// Placeholder for redesign M2 (Today screen, bottom bar, voice).
export default async function ElderHomePage() {
  const { elder } = await requireElderSession();
  return (
    <div className="elder-card elder-narrow">
      <h1 className="elder-title">Hello, {firstName(elder.full_name)}</h1>
      <p className="elder-text">This device is connected to DayMate.</p>
    </div>
  );
}
