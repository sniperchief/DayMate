import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeviceStore, ElderDevice } from "./pairing";

/**
 * Devices are read with `*` and mapped, so optional columns added by later
 * migrations (keep_screen_on) never break pairing; token_hash is dropped here
 * and never leaves this module.
 */
function toDevice(row: Record<string, unknown>): ElderDevice {
  return {
    id: String(row.id),
    caregiver_id: String(row.caregiver_id),
    elder_id: String(row.elder_id),
    name: String(row.name),
    voice_enabled: row.voice_enabled === true,
    keep_screen_on: row.keep_screen_on === true,
    paired_at: String(row.paired_at),
    last_seen_at: (row.last_seen_at as string | null) ?? null,
    revoked_at: (row.revoked_at as string | null) ?? null,
  };
}

/**
 * DeviceStore over `elder_devices` / `elder_pairing_codes`, using the
 * SERVICE-ROLE client. Caregiver/elder IDs come from the verified session or
 * the redeemed code, never from user input.
 */
export function supabaseDeviceStore(admin: SupabaseClient): DeviceStore {
  function fail(op: string, error: { message: string } | null): never {
    throw new Error(`elder devices ${op} failed: ${error?.message ?? "no row"}`);
  }

  return {
    async createPairingCode({ caregiverId, elderId, codeHash, expiresAt, voiceEnabled }) {
      // one active code per elder: drop any unused ones first
      const del = await admin.from("elder_pairing_codes").delete().eq("caregiver_id", caregiverId).eq("elder_id", elderId).is("used_at", null);
      if (del.error) fail("code cleanup", del.error);
      const { error } = await admin.from("elder_pairing_codes").insert({
        caregiver_id: caregiverId,
        elder_id: elderId,
        code_hash: codeHash,
        expires_at: expiresAt.toISOString(),
        voice_enabled: voiceEnabled,
      });
      if (error) fail("code insert", error);
    },

    async redeemPairingCode(codeHash, tokenHash, name) {
      const { data, error } = await admin.rpc("redeem_pairing_code", { p_code_hash: codeHash, p_token_hash: tokenHash, p_name: name });
      if (error) fail("redeem", error);
      return (data as string | null) ?? null;
    },

    async findActiveDevice(tokenHash) {
      const { data, error } = await admin.from("elder_devices").select("*").eq("token_hash", tokenHash).is("revoked_at", null).maybeSingle();
      if (error) fail("select", error);
      return data ? toDevice(data as Record<string, unknown>) : null;
    },

    async touch(deviceId) {
      const { error } = await admin.from("elder_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", deviceId);
      if (error) fail("touch", error);
    },
  };
}

/** Caregiver-side device management (service role, scoped by the verified caregiver ID). */
export function deviceAdmin(admin: SupabaseClient, caregiverId: string) {
  return {
    async list(): Promise<ElderDevice[]> {
      const { data, error } = await admin.from("elder_devices").select("*").eq("caregiver_id", caregiverId).is("revoked_at", null).order("paired_at", { ascending: false });
      if (error) throw new Error(`list devices: ${error.message}`);
      return ((data as Record<string, unknown>[]) ?? []).map(toDevice);
    },
    async revoke(deviceId: string): Promise<boolean> {
      const { data, error } = await admin.from("elder_devices").update({ revoked_at: new Date().toISOString() }).eq("id", deviceId).eq("caregiver_id", caregiverId).is("revoked_at", null).select("id");
      if (error) throw new Error(`revoke device: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
    async setKeepScreenOn(deviceId: string, enabled: boolean): Promise<boolean> {
      const { data, error } = await admin.from("elder_devices").update({ keep_screen_on: enabled }).eq("id", deviceId).eq("caregiver_id", caregiverId).is("revoked_at", null).select("id");
      if (error) throw new Error(`device keep screen on: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
    async setVoice(deviceId: string, enabled: boolean): Promise<boolean> {
      const { data, error } = await admin.from("elder_devices").update({ voice_enabled: enabled }).eq("id", deviceId).eq("caregiver_id", caregiverId).is("revoked_at", null).select("id");
      if (error) throw new Error(`device voice: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
  };
}
