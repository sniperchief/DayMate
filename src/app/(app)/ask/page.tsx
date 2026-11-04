import type { Metadata } from "next";
import { AskDayMate } from "@/components/ask-daymate";
import { firstName, requireElder } from "@/server/page-data";

export const metadata: Metadata = { title: "Ask DayMate" };

export default async function AskPage() {
  const { ctx, elder } = await requireElder();
  const family = await ctx.repo.list("family_members", elder.id);

  // Example questions tailored to what's actually saved (no IDs leave the server).
  const examples = [
    ...new Set([
      ...family.slice(0, 2).map((m) => `Who is my ${m.relationship.trim().toLowerCase()}?`),
      "What am I doing tomorrow?",
      "Who visited me recently?",
      "What do I enjoy?",
      "What is my next activity?",
    ]),
  ].slice(0, 6);

  return (
    <>
      <div className="page-head">
        <h1>Ask DayMate</h1>
        <p>
          Hello, {firstName(elder.full_name)}. Ask about your family, your plans, or things you&apos;ve done. DayMate only answers from what your family has saved.
        </p>
      </div>
      <AskDayMate elderId={elder.id} examples={examples} />
    </>
  );
}
