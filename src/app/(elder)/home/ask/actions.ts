"use server";

import { elderAsk, type ElderAnswer } from "@/server/elder-ask";
import { optionalElderSession } from "@/server/elder-context";

/**
 * Answer a question on a paired elder device (read-only context, its own
 * elder only). Arguments come from the browser and are treated as untrusted.
 */
export async function elderAskAction(question: unknown, elderId: unknown, spoken: unknown = false): Promise<ElderAnswer> {
  const session = await optionalElderSession();
  if (!session) return { ok: false, error: "This device needs to be connected again. Please ask your family member." };
  if (typeof question !== "string" || typeof elderId !== "string") return { ok: false, error: "Please ask a question." };
  try {
    return await elderAsk(session.ctx, { question, elderId, spoken: spoken === true });
  } catch (err) {
    console.error("[daymate] elder ask failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
