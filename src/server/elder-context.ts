import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEVICE_COOKIE, deviceFromToken, type ElderDevice } from "../lib/devices/pairing";
import { supabaseDeviceStore } from "../lib/devices/supabase-store";
import type { Elder } from "../lib/domain/types";
import { adminClient } from "../lib/supabase/admin";
import { createClient } from "../lib/supabase/server";
import { walrusRecaller } from "../lib/walrus-sync/server";
import { elderPhotoStore, noSync, readOnlyRepo, ReadOnlyError, scopedElderRepo } from "./elder-repo";
import { supabasePhotoStore, supabaseRepo } from "./supabase-repo";
import type { Ctx } from "./ports";

export interface ElderSession {
  ctx: Ctx;
  elder: Elder;
  device: ElderDevice;
  /** True when a signed-in caregiver is previewing the elder screens (no paired device). */
  preview: boolean;
}

/** The paired device behind this request's cookie, or null. */
export async function currentDevice(): Promise<ElderDevice | null> {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  return deviceFromToken(supabaseDeviceStore(adminClient()), token);
}

/**
 * Request context for a paired elder device: READ-ONLY and scoped to the one
 * elder the device was paired with. Unpaired or revoked devices go to /pair
 * (a signed-in caregiver gets a read-only preview instead).
 */
export const optionalElderSession = cache(async (): Promise<ElderSession | null> => {
  const device = await currentDevice();
  if (!device) return caregiverPreview();
  const admin = adminClient();
  const repo = scopedElderRepo(admin, device.caregiver_id, device.elder_id);
  const elder = await repo.getElder();
  if (!elder) return null;
  const ctx: Ctx = { userId: device.caregiver_id, repo, photos: elderPhotoStore(admin, device.caregiver_id), sync: noSync, recall: walrusRecaller };
  return { ctx, elder, device, preview: false };
});

/**
 * A signed-in caregiver without a paired-device cookie sees their own elder's
 * screens in READ-ONLY preview, through their own RLS-scoped session.
 */
async function caregiverPreview(): Promise<ElderSession | null> {
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return null;
  const repo = readOnlyRepo(supabaseRepo(db));
  const elder = await repo.getElder();
  if (!elder) return null;
  const photos = supabasePhotoStore(db);
  const deny = async (): Promise<never> => {
    throw new ReadOnlyError("preview");
  };
  const ctx: Ctx = { userId, repo, photos: { signedUrls: (p) => photos.signedUrls(p), upload: deny, remove: deny }, sync: noSync, recall: walrusRecaller };
  const device: ElderDevice = {
    id: "preview",
    caregiver_id: userId,
    elder_id: elder.id,
    name: "Preview",
    voice_enabled: true,
    keep_screen_on: false,
    paired_at: new Date().toISOString(),
    last_seen_at: null,
    revoked_at: null,
  };
  return { ctx, elder, device, preview: true };
}

export async function requireElderSession(): Promise<ElderSession> {
  const session = await optionalElderSession();
  if (!session) redirect("/pair");
  return session;
}
