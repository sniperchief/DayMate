"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { formatCode, startPairing } from "@/lib/devices/pairing";
import { deviceAdmin, supabaseDeviceStore } from "@/lib/devices/supabase-store";
import { uuid } from "@/lib/domain/validation";
import { adminClient } from "@/lib/supabase/admin";
import { requireCtx } from "@/server/context";

export interface PairingState {
  status: "idle" | "ready" | "error";
  message?: string;
  code?: string;
  expiresAt?: string;
  url?: string;
  qrSvg?: string;
}

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** Create a fresh 10-minute pairing code for the caregiver's own elder. */
export async function createPairingCodeAction(_prev: PairingState, formData: FormData): Promise<PairingState> {
  const ctx = await requireCtx();
  try {
    const elder = await ctx.repo.getElder(); // RLS: the caregiver's own elder only
    if (!elder) return { status: "error", message: "Create the profile first." };
    const { code, expiresAt } = await startPairing(supabaseDeviceStore(adminClient()), {
      caregiverId: ctx.userId,
      elderId: elder.id,
      voiceEnabled: formData.get("voice") === "on",
    });
    const url = `${await origin()}/pair?code=${code}`;
    const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return { status: "ready", code: formatCode(code), expiresAt: expiresAt.toISOString(), url, qrSvg };
  } catch (err) {
    console.error("[daymate] pairing code failed:", err instanceof Error ? err.message : err);
    return { status: "error", message: "We couldn't create a code. Please try again." };
  }
}

export async function revokeDeviceAction(deviceId: string): Promise<void> {
  const ctx = await requireCtx();
  if (uuid.safeParse(deviceId).success) await deviceAdmin(adminClient(), ctx.userId).revoke(deviceId);
  revalidatePath("/device");
}

export async function setDeviceVoiceAction(deviceId: string, enabled: boolean): Promise<void> {
  const ctx = await requireCtx();
  if (uuid.safeParse(deviceId).success) await deviceAdmin(adminClient(), ctx.userId).setVoice(deviceId, enabled);
  revalidatePath("/device");
}
