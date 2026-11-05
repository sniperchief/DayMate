"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { completePairing, DEVICE_COOKIE, deviceCookieOptions } from "@/lib/devices/pairing";
import { supabaseDeviceStore } from "@/lib/devices/supabase-store";
import { adminClient } from "@/lib/supabase/admin";

export interface PairState {
  error?: string;
}

/** Redeem a pairing code on the elder's device and remember the device. */
export async function pairDeviceAction(_prev: PairState, formData: FormData): Promise<PairState> {
  const raw = String(formData.get("code") ?? "");
  let paired: Awaited<ReturnType<typeof completePairing>>;
  try {
    paired = await completePairing(supabaseDeviceStore(adminClient()), raw);
  } catch (err) {
    console.error("[daymate] pairing failed:", err instanceof Error ? err.message : err);
    return { error: "Something went wrong. Please try again." };
  }
  if (!paired) return { error: "That code didn't work. It may have expired. Ask your family member for a new code." };
  (await cookies()).set(DEVICE_COOKIE, paired.token, deviceCookieOptions());
  redirect("/home");
}
