import "server-only";
import { redirect } from "next/navigation";
import type { Elder } from "../lib/domain/types";
import { requireCtx } from "./context";
import type { Ctx } from "./ports";

/** For pages that need the elder profile: redirects to /profile if none yet. */
export async function requireElder(): Promise<{ ctx: Ctx; elder: Elder }> {
  const ctx = await requireCtx();
  const elder = await ctx.repo.getElder();
  if (!elder) redirect("/profile?notice=need-profile");
  return { ctx, elder };
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
