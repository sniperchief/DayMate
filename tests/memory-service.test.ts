// Uses a MOCK Walrus Memory client (tests/mock-client.ts). These tests check
// application logic only; they are not evidence of Mainnet storage.
import { describe, expect, it } from "vitest";
import { MemWalRememberJobFailedError, MemWalRememberJobNotFoundError, MemWalRememberJobTimeoutError } from "@mysten-incubation/memwal";
import { MemoryServiceError } from "../src/lib/memory";
import { FAKE_KEY, NAMESPACE, mockClient, mockFetch, serviceWith } from "./mock-client";

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (!(e instanceof MemoryServiceError)) throw e;
    expect(e.toSafeString()).not.toContain(FAKE_KEY);
    return e.code;
  }
  return "RESOLVED";
}

function httpError(status: number, message = "boom") {
  return Object.assign(new Error(message), { status });
}

describe("[mock] MemoryService.checkConnection", () => {
  it("reports a healthy Mainnet relayer and verifies credentials", async () => {
    const client = mockClient();
    const report = await serviceWith(client).checkConnection();
    expect(report).toMatchObject({ network: "mainnet", relayerStatus: "ok", writeReady: true, credentialsVerified: true, memoriesInNamespace: 0 });
    expect(client.listMemories).toHaveBeenCalledWith(expect.objectContaining({ namespace: NAMESPACE }));
  });

  it("refuses a non-Mainnet relayer", async () => {
    expect(await codeOf(serviceWith(mockClient(), mockFetch("testnet")).checkConnection())).toBe("NOT_MAINNET");
  });

  it("maps an unreachable relayer to RELAYER_UNAVAILABLE", async () => {
    const netErr = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const client = mockClient({ health: () => Promise.reject(netErr) });
    expect(await codeOf(serviceWith(client).checkConnection())).toBe("RELAYER_UNAVAILABLE");
  });

  it("maps a relayer 5xx on /config to RELAYER_UNAVAILABLE", async () => {
    expect(await codeOf(serviceWith(mockClient(), mockFetch("mainnet", false)).checkConnection())).toBe("RELAYER_UNAVAILABLE");
  });

  it("maps 401 (unregistered delegate key / wrong account) to AUTH_REJECTED", async () => {
    const client = mockClient({ listMemories: () => Promise.reject(httpError(401, "delegate key not registered")) });
    expect(await codeOf(serviceWith(client).checkConnection())).toBe("AUTH_REJECTED");
  });

  it("flags paused writes", async () => {
    const client = mockClient({ health: () => Promise.resolve({ status: "ok", version: "0.1.0", write_ready: false, writes: "paused" }) });
    const report = await serviceWith(client).checkConnection({ verifyCredentials: false });
    expect(report.writeReady).toBe(false);
    expect(report.credentialsVerified).toBe(false);
  });
});

describe("[mock] MemoryService.rememberConfirmed", () => {
  it("returns job and blob IDs only after the job completes", async () => {
    const client = mockClient();
    const w = await serviceWith(client).rememberConfirmed("  Clara is Margaret's daughter.  ", { dedupe: true });
    expect(w).toEqual({ status: "done", jobId: "job-1", blobId: "MOCK_BLOB_1", memoryId: "mem-1", owner: "0xowner", namespace: NAMESPACE });
    expect(client.remember).toHaveBeenCalledWith("Clara is Margaret's daughter.", { dedupe: true });
    expect(client.waitForRememberJob).toHaveBeenCalledWith("job-1", expect.any(Object));
  });

  it("treats a job still pending at the deadline as WRITE_PENDING, not success", async () => {
    const client = mockClient({ waitForRememberJob: () => Promise.reject(new MemWalRememberJobTimeoutError("timed out", "job-1", 1000, "uploaded")) });
    try {
      await serviceWith(client).rememberConfirmed("x");
      expect.unreachable();
    } catch (e) {
      expect((e as MemoryServiceError).code).toBe("WRITE_PENDING");
      expect((e as MemoryServiceError).details).toMatchObject({ jobId: "job-1", lastStatus: "uploaded" });
    }
  });

  it("maps a failed job to WRITE_FAILED", async () => {
    const client = mockClient({ waitForRememberJob: () => Promise.reject(new MemWalRememberJobFailedError("job-1", "walrus upload failed")) });
    expect(await codeOf(serviceWith(client).rememberConfirmed("x"))).toBe("WRITE_FAILED");
  });

  it("maps an unknown job to JOB_NOT_FOUND", async () => {
    const client = mockClient({ waitForRememberJob: () => Promise.reject(new MemWalRememberJobNotFoundError("job-1")) });
    expect(await codeOf(serviceWith(client).rememberConfirmed("x"))).toBe("JOB_NOT_FOUND");
  });

  it("refuses to confirm a completed job with no blob ID", async () => {
    const client = mockClient({ waitForRememberJob: () => Promise.resolve({ id: "m", job_id: "job-1", blob_id: "", owner: "o", namespace: NAMESPACE }) });
    expect(await codeOf(serviceWith(client).rememberConfirmed("x"))).toBe("WRITE_UNCONFIRMED");
  });

  it("refuses to confirm when the submit returns no job ID", async () => {
    const client = mockClient({ remember: () => Promise.resolve({ status: "running" }) });
    expect(await codeOf(serviceWith(client).rememberConfirmed("x"))).toBe("WRITE_UNCONFIRMED");
  });

  it("refuses a write that landed in another namespace", async () => {
    const client = mockClient({ waitForRememberJob: () => Promise.resolve({ id: "m", job_id: "j", blob_id: "b", owner: "o", namespace: "default" }) });
    expect(await codeOf(serviceWith(client).rememberConfirmed("x"))).toBe("WRITE_UNCONFIRMED");
  });

  it("rejects empty text without calling the relayer", async () => {
    const client = mockClient();
    expect(await codeOf(serviceWith(client).rememberConfirmed("   "))).toBe("INVALID_INPUT");
    expect(client.remember).not.toHaveBeenCalled();
  });

  it("maps paused writes, rate limits and timeouts", async () => {
    const paused = mockClient({ remember: () => Promise.reject(httpError(503, "writes are paused")) });
    expect(await codeOf(serviceWith(paused).rememberConfirmed("x"))).toBe("WRITES_PAUSED");
    const limited = mockClient({ remember: () => Promise.reject(httpError(429, "slow down")) });
    expect(await codeOf(serviceWith(limited).rememberConfirmed("x"))).toBe("RATE_LIMITED");
    const timeout = Object.assign(new Error("POST /api/remember timed out"), { name: "MemWalRequestTimeout" });
    const slow = mockClient({ remember: () => Promise.reject(timeout) });
    expect(await codeOf(serviceWith(slow).rememberConfirmed("x"))).toBe("TIMEOUT");
  });

  it("redacts the delegate key if an upstream error echoes it", async () => {
    const client = mockClient({ remember: () => Promise.reject(httpError(400, `bad key ${FAKE_KEY}`)) });
    try {
      await serviceWith(client).rememberConfirmed("x");
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(FAKE_KEY);
      expect((e as Error).message).toContain("[REDACTED]");
    }
  });
});

describe("[mock] MemoryService.recall", () => {
  it("queries the DayMate namespace and maps results", async () => {
    const client = mockClient({
      recall: () => Promise.resolve({ results: [{ blob_id: "b1", text: "Clara is the daughter", distance: 0.2, created_at: "2026-11-02T00:00:00Z" }], total: 1 }),
    });
    const out = await serviceWith(client).recall("Who is the daughter?", { limit: 3 });
    expect(client.recall).toHaveBeenCalledWith({ query: "Who is the daughter?", limit: 3, namespace: NAMESPACE });
    expect(out).toMatchObject({ empty: false, total: 1, results: [{ blobId: "b1", text: "Clara is the daughter", distance: 0.2 }] });
  });

  it("reports empty results explicitly", async () => {
    const out = await serviceWith(mockClient()).recall("anything");
    expect(out.empty).toBe(true);
    expect(out.results).toEqual([]);
  });

  it("validates query and limit", async () => {
    expect(await codeOf(serviceWith(mockClient()).recall(""))).toBe("INVALID_INPUT");
    expect(await codeOf(serviceWith(mockClient()).recall("q", { limit: 0 }))).toBe("INVALID_INPUT");
  });
});

describe("[mock] MemoryService.listNamespaceMemories", () => {
  it("paginates with has_more", async () => {
    const page = (ids: string[], more: boolean, cursor: string | null) => ({ memories: ids.map((id) => ({ blob_id: id })), has_more: more, next_cursor: cursor, snapshot_version: 1, deleted: [], must_resync: false });
    const client = mockClient();
    client.listMemories.mockResolvedValueOnce(page(["a", "b"], true, "c1")).mockResolvedValueOnce(page(["c"], false, null));
    const all = await serviceWith(client).listNamespaceMemories();
    expect(all.map((m) => m.blob_id)).toEqual(["a", "b", "c"]);
    expect(client.listMemories).toHaveBeenLastCalledWith({ cursor: "c1", namespace: NAMESPACE });
  });
});
