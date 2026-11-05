import type { Metadata } from "next";
import { elderAskAction } from "@/app/(elder)/home/ask/actions";
import { AskDayMate } from "@/components/ask-daymate";
import { requireElderSession } from "@/server/elder-context";

export const metadata: Metadata = { title: "Ask" };

// Redesign M2: tap and type. M3 replaces this with the voice-first Ask screen.
export default async function ElderAskPage() {
  const { ctx, elder } = await requireElderSession();
  const family = await ctx.repo.list("family_members", elder.id);
  const examples = [
    ...new Set([
      "What am I doing today?",
      "What am I doing tomorrow?",
      ...family.slice(0, 2).map((m) => `Who is my ${m.relationship.trim().toLowerCase()}?`),
      "Who visited me recently?",
      "What do I enjoy?",
    ]),
  ].slice(0, 6);

  return (
    <div className="elder-ask">
      <h1 className="elder-title">Ask me</h1>
      <AskDayMate elderId={elder.id} examples={examples} action={elderAskAction} />
    </div>
  );
}
