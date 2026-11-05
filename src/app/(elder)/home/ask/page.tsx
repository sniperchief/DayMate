import type { Metadata } from "next";
import { elderAskAction } from "@/app/(elder)/home/ask/actions";
import { VoiceAsk } from "@/components/elder/voice-ask";
import { requireElderSession } from "@/server/elder-context";

export const metadata: Metadata = { title: "Ask" };

export default async function ElderAskPage() {
  const { ctx, elder, device } = await requireElderSession();
  const family = await ctx.repo.list("family_members", elder.id);
  const suggestions = [
    ...new Set([
      "What am I doing today?",
      ...family.slice(0, 2).map((m) => `Who is my ${m.relationship.trim().toLowerCase()}?`),
      "Who visited me recently?",
      "What am I doing tomorrow?",
      "What do I enjoy?",
    ]),
  ].slice(0, 5);

  return (
    <>
      <h1 className="elder-title">Ask me</h1>
      <VoiceAsk elderId={elder.id} suggestions={suggestions} voiceEnabled={device.voice_enabled} action={elderAskAction} />
    </>
  );
}
