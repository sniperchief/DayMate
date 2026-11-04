import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MemoryService, MemoryServiceError, toMemoryError } from "../src/lib/memory";

export const STATE_DIR = resolve(process.cwd(), ".daymate");

/** Load `.env` (if present) into process.env without overriding real env vars. */
export function loadEnv(): void {
  const path = resolve(process.cwd(), ".env");
  if (existsSync(path)) process.loadEnvFile(path);
}

export function createService(): MemoryService {
  loadEnv();
  return MemoryService.fromEnv(process.env);
}

/** Write a JSON report under .daymate/reports and return its path. */
export function writeReport(name: string, data: unknown): string {
  const dir = join(STATE_DIR, "reports");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `${name}-${stamp}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
  return path;
}

/** Run a CLI entry point; print errors safely (never credentials) and set exit code. */
export function main(fn: () => Promise<number | void>): void {
  fn().then(
    (code) => {
      process.exitCode = code ?? 0;
    },
    (err: unknown) => {
      const e = err instanceof MemoryServiceError ? err : toMemoryError(err, "unexpected");
      console.error(`\n✗ ${e.toSafeString()}`);
      process.exitCode = 1;
    },
  );
}
