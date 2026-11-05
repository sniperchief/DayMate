import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEVICE_COOKIE, deviceFromToken, type ElderDevice } from "../lib/devices/pairing";
import { supabaseDeviceStore } from "../lib/devices/supabase-store";
import type { Elder } from "../lib/domain/types";
import { adminClient } from "../lib/supabase/admin";
import { walrusRecaller } from "../lib/walrus-sync/server";
import { elderPhotoStore, noSync, scopedElderRepo } from "./elder-repo";
import type { Ctx } from "./ports";

export interface ElderSession {
  ctx: Ctx;
  elder: Elder;
  device: ElderDevice;
}

/** The paired device behind this request's cookie, or null. */
export async function currentDevice(): Promise<ElderDevice | null> {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  return deviceFromToken(supabaseDeviceStore(adminClient()), token);
}

/**
 * Request context for a paired elder device: READ-ONLY and scoped to the one
 * elder the device was paired with. Unpaired or revoked devices go to /pair.
 */
export async function optionalElderSession(): Promise<ElderSession | null> {
  const device = await currentDevice();
  if (!device) return null;
  const admin = adminClient();
  const repo = scopedElderRepo(admin, device.caregiver_id, device.elder_id);
  const elder = await repo.getElder();
  if (!elder) return null;
  const ctx: Ctx = { userId: device.caregiver_id, repo, photos: elderPhotoStore(admin, device.caregiver_id), sync: noSync, recall: walrusRecaller };
  return { ctx, elder, device };
}

export async function requireElderSession(): Promise<ElderSession> {
  const session = await optionalElderSession();
  if (!session) redirect("/pair");
  return session;
}
