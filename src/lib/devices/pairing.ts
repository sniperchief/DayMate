import { createHash, randomBytes, randomInt } from "node:crypto";
import { isWellFormedToken } from "./cookie";

export { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, deviceCookieOptions, isWellFormedToken } from "./cookie";

/**
 * Pairing an elder's tablet or phone without a password.
 *
 * The caregiver creates a short-lived, single-use code; the elder's device
 * redeems it and receives a random 32-byte token in an httpOnly cookie. Only
 * SHA-256 hashes of codes and tokens are stored, so a database leak does not
 * reveal a usable code or device credential.
 *
 * Codes are 8 characters from a 31-character alphabet with no look-alikes
 * (no I, L, O, 0, 1): 31^8 ≈ 8.5e11 combinations, valid for 10 minutes,
 * one active code per elder.
 */

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;
export const CODE_TTL_MS = 10 * 60_000;
/** last_seen_at is written at most this often. */
export const TOUCH_INTERVAL_MS = 5 * 60_000;

export function generatePairingCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Accepts "kq7m-4xpd", "KQ7M 4XPD", etc. Returns null when it cannot be a code. */
export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, "");
  if (c.length !== CODE_LENGTH) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}


// ── store port + flows ────────────────────────────────────────────────────

export interface ElderDevice {
  id: string;
  caregiver_id: string;
  elder_id: string;
  name: string;
  voice_enabled: boolean;
  /** Redesign M6; false/undefined before that migration is applied. */
  keep_screen_on?: boolean;
  paired_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export interface DeviceStore {
  /** Replaces any unused code for this elder with a new one. */
  createPairingCode(input: { caregiverId: string; elderId: string; codeHash: string; expiresAt: Date; voiceEnabled: boolean }): Promise<void>;
  /** Atomically marks the code used and creates the device; null if invalid, used or expired. */
  redeemPairingCode(codeHash: string, tokenHash: string, name: string): Promise<string | null>;
  /** Active (not revoked) device by token hash. */
  findActiveDevice(tokenHash: string): Promise<ElderDevice | null>;
  touch(deviceId: string): Promise<void>;
}

export async function startPairing(store: DeviceStore, input: { caregiverId: string; elderId: string; voiceEnabled: boolean; now?: Date }): Promise<{ code: string; expiresAt: Date }> {
  const code = generatePairingCode();
  const expiresAt = new Date((input.now ?? new Date()).getTime() + CODE_TTL_MS);
  await store.createPairingCode({ caregiverId: input.caregiverId, elderId: input.elderId, codeHash: hashSecret(code), expiresAt, voiceEnabled: input.voiceEnabled });
  return { code, expiresAt };
}

/** Redeem a typed or scanned code. Returns the raw device token (to set as the cookie) or null. */
export async function completePairing(store: DeviceStore, rawCode: string, name = "Elder's device"): Promise<{ token: string; deviceId: string } | null> {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const token = newDeviceToken();
  const deviceId = await store.redeemPairingCode(hashSecret(code), hashSecret(token), name.slice(0, 60));
  return deviceId ? { token, deviceId } : null;
}

/** Resolve the device behind a cookie value; refreshes last_seen_at occasionally. */
export async function deviceFromToken(store: DeviceStore, token: string | undefined | null, now = new Date()): Promise<ElderDevice | null> {
  if (!isWellFormedToken(token)) return null;
  const device = await store.findActiveDevice(hashSecret(token));
  if (!device || device.revoked_at) return null;
  const seen = device.last_seen_at ? new Date(device.last_seen_at).getTime() : 0;
  if (now.getTime() - seen > TOUCH_INTERVAL_MS) {
    try {
      await store.touch(device.id);
    } catch {
      // bookkeeping only; never block the elder
    }
  }
  return device;
}
