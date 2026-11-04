/**
 * MOCK Walrus Memory client — FOR ISOLATED UNIT TESTS ONLY.
 * Nothing here touches Walrus or Mainnet; results from it prove nothing
 * about real storage.
 */
import { vi } from "vitest";
import type { MemoryClient } from "../src/lib/memory";
import { MemoryService } from "../src/lib/memory";

export const FAKE_KEY = "cd".repeat(32);
export const FAKE_ACCOUNT = "0x" + "34".repeat(32);
export const NAMESPACE = "daymate-test";

export function mockClient(overrides: Partial<Record<keyof MemoryClient, unknown>> = {}) {
  const client = {
    health: vi.fn().mockResolvedValue({ status: "ok", version: "0.1.0", relayerVersion: "0.1.0", apiVersion: "1.0.0", mode: "production", write_ready: true, writes: "ok" }),
    remember: vi.fn().mockResolvedValue({ job_id: "job-1", status: "running" }),
    waitForRememberJob: vi.fn().mockResolvedValue({ id: "mem-1", job_id: "job-1", blob_id: "MOCK_BLOB_1", owner: "0xowner", namespace: NAMESPACE }),
    getRememberStatus: vi.fn().mockResolvedValue({ job_id: "job-1", status: "running" }),
    recall: vi.fn().mockResolvedValue({ results: [], total: 0 }),
    listMemories: vi.fn().mockResolvedValue({ memories: [], next_cursor: null, has_more: false, snapshot_version: 1, deleted: [], must_resync: false }),
    destroy: vi.fn(),
  };
  for (const [name, impl] of Object.entries(overrides)) {
    (client as Record<string, unknown>)[name] = vi.fn(impl as (...args: unknown[]) => unknown);
  }
  return client as unknown as MemoryClient & Record<keyof MemoryClient, ReturnType<typeof vi.fn>>;
}

export function mockFetch(network = "mainnet", ok = true) {
  return vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 503, json: async () => ({ network }) });
}

export function serviceWith(client: MemoryClient, fetchImpl = mockFetch()) {
  return new MemoryService(
    { accountId: FAKE_ACCOUNT, privateKey: FAKE_KEY, serverUrl: "https://relayer.memory.walrus.xyz", namespace: NAMESPACE },
    { client, fetch: fetchImpl },
  );
}
