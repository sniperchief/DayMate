"use server";

import { ask, type AskResult } from "@/server/ask";
import { optionalElderSession } from "@/server/elder-context";

/** Answer a question on a paired elder device (read-only context, its own elder only). */
export async function elderAskAction(question: unknown, elderId: unknown): Promise<AskResult> {
  const session = await optionalElderSession();
  if (!session) return { ok: false, error: "This device needs to be connected again. Please ask your family member." };
  if (typeof question !== "string" || typeof elderId !== "string") return { ok: false, error: "Please ask a question." };
  return ask(session.ctx, question, { elderId });
}
