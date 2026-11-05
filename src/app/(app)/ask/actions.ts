"use server";

import { optionalCtx } from "@/server/context";
import { ask, type AskResult } from "@/server/ask";

/**
 * Answer one question for the signed-in caregiver's elder. Arguments come
 * from the browser and are treated as untrusted: the session is verified
 * here, and `ask` checks the question and that `elderId` is this caregiver's.
 */
export async function askAction(question: unknown, elderId: unknown): Promise<AskResult> {
  const ctx = await optionalCtx();
  if (!ctx) return { ok: false, error: "Your session has ended. Please sign in again." };
  if (typeof question !== "string" || typeof elderId !== "string") return { ok: false, error: "Please type a question." };
  return ask(ctx, question, { elderId });
}
