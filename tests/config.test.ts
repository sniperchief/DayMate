import { describe, expect, it } from "vitest";
import { MAINNET_RELAYER_URL, MemoryServiceError, describeConfig, loadMemoryConfig } from "../src/lib/memory";

// Synthetic, non-functional test values (not real credentials).
const FAKE_KEY = "ab".repeat(32);
const FAKE_ACCOUNT = "0x" + "12".repeat(32);
const valid = { MEMWAL_ACCOUNT_ID: FAKE_ACCOUNT, MEMWAL_PRIVATE_KEY: FAKE_KEY, MEMWAL_NAMESPACE: "daymate-phase1" };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof MemoryServiceError ? e.code : "NOT_MEMORY_ERROR";
  }
  return undefined;
}

describe("loadMemoryConfig", () => {
  it("defaults to the production Mainnet relayer", () => {
    expect(loadMemoryConfig(valid).serverUrl).toBe(MAINNET_RELAYER_URL);
    expect(MAINNET_RELAYER_URL).toBe("https://relayer.memory.walrus.xyz");
  });

  it("reports every missing variable", () => {
    try {
      loadMemoryConfig({});
      expect.unreachable();
    } catch (e) {
      expect((e as MemoryServiceError).code).toBe("CONFIG_MISSING");
      expect((e as Error).message).toContain("MEMWAL_ACCOUNT_ID");
      expect((e as Error).message).toContain("MEMWAL_PRIVATE_KEY");
      expect((e as Error).message).toContain("MEMWAL_NAMESPACE");
    }
  });

  it("treats blank values as missing", () => {
    expect(codeOf(() => loadMemoryConfig({ ...valid, MEMWAL_PRIVATE_KEY: "   " }))).toBe("CONFIG_MISSING");
  });

  it("rejects .env.example placeholders", () => {
    expect(codeOf(() => loadMemoryConfig({ ...valid, MEMWAL_PRIVATE_KEY: "YOUR_DELEGATE_PRIVATE_KEY" }))).toBe("CONFIG_INVALID");
    expect(codeOf(() => loadMemoryConfig({ ...valid, MEMWAL_ACCOUNT_ID: "0xYOUR_MEMWAL_ACCOUNT_OBJECT_ID" }))).toBe("CONFIG_INVALID");
  });

  it("validates account ID and key formats", () => {
    expect(codeOf(() => loadMemoryConfig({ ...valid, MEMWAL_ACCOUNT_ID: "not-an-id" }))).toBe("CONFIG_INVALID");
    expect(codeOf(() => loadMemoryConfig({ ...valid, MEMWAL_PRIVATE_KEY: "abc123" }))).toBe("CONFIG_INVALID");
    expect(codeOf(() => loadMemoryConfig({ ...valid, MEMWAL_PRIVATE_KEY: "0x" + FAKE_KEY }))).toBeUndefined();
    expect(codeOf(() => loadMemoryConfig({ ...valid, MEMWAL_PRIVATE_KEY: "suiprivkey1qexample" }))).toBeUndefined();
  });

  it("never echoes the key in validation errors", () => {
    const badKey = "zz".repeat(32);
    try {
      loadMemoryConfig({ ...valid, MEMWAL_PRIVATE_KEY: badKey });
      expect.unreachable();
    } catch (e) {
      expect((e as MemoryServiceError).message).not.toContain(badKey);
      expect((e as MemoryServiceError).toSafeString()).not.toContain(badKey);
    }
  });

  it("requires https and a dedicated namespace", () => {
    expect(codeOf(() => loadMemoryConfig({ ...valid, MEMWAL_SERVER_URL: "http://relayer.memory.walrus.xyz" }))).toBe("CONFIG_INVALID");
    expect(codeOf(() => loadMemoryConfig({ ...valid, MEMWAL_NAMESPACE: "default" }))).toBe("CONFIG_INVALID");
    expect(codeOf(() => loadMemoryConfig({ ...valid, MEMWAL_NAMESPACE: "Has Spaces" }))).toBe("CONFIG_INVALID");
  });

  it("strips trailing slashes from the server URL", () => {
    expect(loadMemoryConfig({ ...valid, MEMWAL_SERVER_URL: "https://relayer.memory.walrus.xyz/" }).serverUrl).toBe(MAINNET_RELAYER_URL);
  });

  it("describeConfig redacts the key", () => {
    const d = describeConfig(loadMemoryConfig(valid));
    expect(JSON.stringify(d)).not.toContain(FAKE_KEY);
    expect(d.privateKey).toBe("[REDACTED]");
  });
});
