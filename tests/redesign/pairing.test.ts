// Pairing logic against an in-memory MOCK store — the real store is checked live by `npm run device:check`.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_TTL_MS,
  completePairing,
  deviceFromToken,
  formatCode,
  generatePairingCode,
  hashSecret,
  isWellFormedToken,
  newDeviceToken,
  normalizeCode,
  startPairing,
  TOUCH_INTERVAL_MS,
  type DeviceStore,
  type ElderDevice,
} from "../../src/lib/devices/pairing";

/** [mock] Mirrors the SQL: one active code per elder, single use, expiry, hashed secrets only. */
function fakeStore(clock: { now: number }) {
  const codes: { caregiverId: string; elderId: string; codeHash: string; expiresAt: number; usedAt: number | null; voiceEnabled: boolean }[] = [];
  const devices: (ElderDevice & { token_hash: string })[] = [];
  const touches: string[] = [];
  const store: DeviceStore & { codes: typeof codes; devices: typeof devices; touches: string[] } = {
    codes,
    devices,
    touches,
    async createPairingCode(i) {
      for (let k = codes.length - 1; k >= 0; k--) if (codes[k]!.elderId === i.elderId && codes[k]!.usedAt === null) codes.splice(k, 1);
      codes.push({ ...i, expiresAt: i.expiresAt.getTime(), usedAt: null });
    },
    async redeemPairingCode(codeHash, tokenHash, name) {
      const c = codes.find((x) => x.codeHash === codeHash && x.usedAt === null && x.expiresAt > clock.now);
      if (!c) return null;
      c.usedAt = clock.now;
      const id = randomUUID();
      devices.push({ id, caregiver_id: c.caregiverId, elder_id: c.elderId, name, voice_enabled: c.voiceEnabled, paired_at: new Date(clock.now).toISOString(), last_seen_at: null, revoked_at: null, token_hash: tokenHash });
      return id;
    },
    async findActiveDevice(tokenHash) {
      return devices.find((d) => d.token_hash === tokenHash && !d.revoked_at) ?? null;
    },
    async touch(id) {
      touches.push(id);
      const d = devices.find((x) => x.id === id)!;
      d.last_seen_at = new Date(clock.now).toISOString();
    },
  };
  return store;
}

const A = { caregiverId: "c0000000-0000-4000-8000-00000000000a", elderId: "e0000000-0000-4000-8000-00000000000a" };

describe("pairing codes", () => {
  it("uses 8 characters from an alphabet without look-alikes", () => {
    for (let i = 0; i < 200; i++) {
      const c = generatePairingCode();
      expect(c).toHaveLength(CODE_LENGTH);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
    expect(CODE_ALPHABET).not.toMatch(/[IL O01]/);
    expect(new Set(Array.from({ length: 500 }, generatePairingCode)).size).toBe(500);
  });

  it("normalises what people type and rejects anything else", () => {
    expect(normalizeCode("kq7m-4xpd")).toBe("KQ7M4XPD");
    expect(normalizeCode(" KQ7M 4XPD ")).toBe("KQ7M4XPD");
    expect(normalizeCode("KQ7M4XP")).toBeNull(); // too short
    expect(normalizeCode("KQ7M4XP0")).toBeNull(); // 0 is not in the alphabet
    expect(normalizeCode("<script>")).toBeNull();
    expect(formatCode("KQ7M4XPD")).toBe("KQ7M-4XPD");
  });

  it("device tokens are 32 random bytes, base64url", () => {
    const t = newDeviceToken();
    expect(isWellFormedToken(t)).toBe(true);
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(isWellFormedToken("short")).toBe(false);
    expect(isWellFormedToken(undefined)).toBe(false);
  });
});

describe("[mock] pairing flow", () => {
  it("pairs a device with a fresh code; only hashes are stored", async () => {
    const clock = { now: Date.now() };
    const store = fakeStore(clock);
    const { code, expiresAt } = await startPairing(store, { ...A, voiceEnabled: true, now: new Date(clock.now) });
    expect(expiresAt.getTime() - clock.now).toBe(CODE_TTL_MS);
    expect(store.codes[0]!.codeHash).toBe(hashSecret(code));
    expect(JSON.stringify(store.codes)).not.toContain(code);

    const paired = await completePairing(store, formatCode(code).toLowerCase());
    expect(paired).not.toBeNull();
    expect(store.devices[0]).toMatchObject({ caregiver_id: A.caregiverId, elder_id: A.elderId, voice_enabled: true, token_hash: hashSecret(paired!.token) });
    expect(JSON.stringify(store.devices)).not.toContain(paired!.token);

    const device = await deviceFromToken(store, paired!.token, new Date(clock.now));
    expect(device?.elder_id).toBe(A.elderId);
  });

  it("a code works only once", async () => {
    const clock = { now: Date.now() };
    const store = fakeStore(clock);
    const { code } = await startPairing(store, { ...A, voiceEnabled: false });
    expect(await completePairing(store, code)).not.toBeNull();
    expect(await completePairing(store, code)).toBeNull();
    expect(store.devices).toHaveLength(1);
  });

  it("an expired code is rejected", async () => {
    const clock = { now: Date.now() };
    const store = fakeStore(clock);
    const { code } = await startPairing(store, { ...A, voiceEnabled: false, now: new Date(clock.now) });
    clock.now += CODE_TTL_MS + 1;
    expect(await completePairing(store, code)).toBeNull();
  });

  it("creating a new code invalidates the previous unused one", async () => {
    const clock = { now: Date.now() };
    const store = fakeStore(clock);
    const first = await startPairing(store, { ...A, voiceEnabled: false });
    const second = await startPairing(store, { ...A, voiceEnabled: false });
    expect(await completePairing(store, first.code)).toBeNull();
    expect(await completePairing(store, second.code)).not.toBeNull();
  });

  it("wrong, malformed or empty codes never pair", async () => {
    const clock = { now: Date.now() };
    const store = fakeStore(clock);
    await startPairing(store, { ...A, voiceEnabled: false });
    for (const bad of ["", "AAAA-AAAA", "not a code", "KQ7M4XPDX"]) expect(await completePairing(store, bad)).toBeNull();
    expect(store.devices).toHaveLength(0);
  });

  it("a revoked device stops working immediately", async () => {
    const clock = { now: Date.now() };
    const store = fakeStore(clock);
    const { code } = await startPairing(store, { ...A, voiceEnabled: false });
    const { token } = (await completePairing(store, code))!;
    store.devices[0]!.revoked_at = new Date().toISOString();
    expect(await deviceFromToken(store, token)).toBeNull();
  });

  it("unknown or malformed cookies resolve to no device", async () => {
    const store = fakeStore({ now: Date.now() });
    expect(await deviceFromToken(store, newDeviceToken())).toBeNull();
    expect(await deviceFromToken(store, "garbage")).toBeNull();
    expect(await deviceFromToken(store, null)).toBeNull();
  });

  it("last_seen_at is refreshed at most every few minutes", async () => {
    const clock = { now: Date.now() };
    const store = fakeStore(clock);
    const { code } = await startPairing(store, { ...A, voiceEnabled: false });
    const { token } = (await completePairing(store, code))!;
    await deviceFromToken(store, token, new Date(clock.now));
    await deviceFromToken(store, token, new Date(clock.now + 60_000));
    expect(store.touches).toHaveLength(1);
    clock.now += TOUCH_INTERVAL_MS + 1;
    await deviceFromToken(store, token, new Date(clock.now));
    expect(store.touches).toHaveLength(2);
  });
});
