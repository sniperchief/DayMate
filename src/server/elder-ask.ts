import type { FamilyMember } from "../lib/domain/types";
import { peopleInAnswer } from "../lib/elder/answer-people";
import { firstName } from "../lib/elder/today";
import { prepareSpokenQuestion } from "../lib/elder/spoken";
import { ask, MAX_QUESTION_LENGTH } from "./ask";
import type { Ctx } from "./ports";

/**
 * Ask DayMate for the elder's own screen. Wraps the unchanged `ask()`:
 * spoken questions are cleaned first, and the answer comes back with the
 * photos of the saved people it mentions. Never returns IDs or storage paths.
 */

export interface AnswerPerson {
  name: string;
  relationship: string;
  photoUrl: string | null;
}

export type ElderAnswer =
  | { ok: true; heard: string; text: string; noAnswer: boolean; people: AnswerPerson[] }
  | { ok: false; heard?: string; error: string };

export const DID_NOT_CATCH = "I didn't catch that. Tap the microphone and try again.";

export async function elderAsk(ctx: Ctx, input: { question: string; elderId: string; spoken: boolean }, now?: Date): Promise<ElderAnswer> {
  const raw = input.question.slice(0, MAX_QUESTION_LENGTH * 2);
  let family: FamilyMember[];
  try {
    const elder = await ctx.repo.getElder();
    family = elder ? await ctx.repo.list("family_members", elder.id) : [];
  } catch {
    family = [];
  }
  const heard = input.spoken ? prepareSpokenQuestion(raw, family.map((m) => firstName(m.full_name))) : raw.trim();
  if (!heard) return { ok: false, error: input.spoken ? DID_NOT_CATCH : "Please ask a question." };

  const res = await ask(ctx, heard, { elderId: input.elderId, now });
  if (!res.ok) return { ok: false, heard, error: res.error };

  const people = res.answer.noAnswer ? [] : peopleInAnswer(res.answer.text, family);
  let urls: Record<string, string> = {};
  try {
    urls = await ctx.photos.signedUrls(people.map((p) => p.photo_path).filter((p): p is string => Boolean(p)));
  } catch {
    urls = {};
  }
  return {
    ok: true,
    heard,
    text: res.answer.text,
    noAnswer: Boolean(res.answer.noAnswer),
    people: people.map((p) => ({ name: p.full_name, relationship: p.relationship.trim().toLowerCase(), photoUrl: p.photo_path ? (urls[p.photo_path] ?? null) : null })),
  };
}
