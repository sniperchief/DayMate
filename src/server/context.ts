import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import { suiAnchorer } from "../lib/sui-anchor/server";
import { walrusRecaller, walrusSyncer } from "../lib/walrus-sync/server";
import type { Ctx } from "./ports";
import { supabasePhotoStore, supabaseRepo } from "./supabase-repo";

/**
 * Build the request context for an authenticated caregiver. The user ID is
 * taken from the verified session JWT; unauthenticated calls are redirected.
 */
export async function requireCtx(): Promise<Ctx> {
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) redirect("/login");
  return { userId, repo: supabaseRepo(db), photos: supabasePhotoStore(db), sync: walrusSyncer, recall: walrusRecaller, anchor: suiAnchorer };
}

/** Like requireCtx, but returns null instead of redirecting (for server actions that report errors). */
export async function optionalCtx(): Promise<Ctx | null> {
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return null;
  return { userId, repo: supabaseRepo(db), photos: supabasePhotoStore(db), sync: walrusSyncer, recall: walrusRecaller, anchor: suiAnchorer };
}
