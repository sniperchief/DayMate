import type { Elder, FamilyMember, Memory, Routine, WalrusRecord } from "../lib/domain/types";
import type { SyncOutcome, SyncSource } from "../lib/walrus-sync/sync";

export interface Tables {
  elders: Elder;
  family_members: FamilyMember;
  routines: Routine;
  memories: Memory;
}
export type ContentTable = Exclude<keyof Tables, "elders">;

/**
 * Data access for ONE authenticated caregiver. The production implementation
 * uses the user's own Supabase session, so Row Level Security applies to
 * every call; rows of other caregivers are simply invisible (null / []).
 */
export interface Repo {
  getElder(): Promise<Elder | null>;
  insertElder(row: Omit<Elder, "id" | "caregiver_id" | "created_at" | "updated_at">): Promise<Elder>;
  updateElder(id: string, patch: Partial<Elder>): Promise<Elder | null>;
  list<T extends ContentTable>(table: T, elderId: string): Promise<Tables[T][]>;
  get<T extends ContentTable>(table: T, id: string): Promise<Tables[T] | null>;
  insert<T extends ContentTable>(table: T, row: Partial<Tables[T]>): Promise<Tables[T]>;
  update<T extends ContentTable>(table: T, id: string, patch: Partial<Tables[T]>): Promise<Tables[T] | null>;
  remove(table: ContentTable, id: string): Promise<boolean>;
  memoriesForPerson(personId: string): Promise<Memory[]>;
  walrusRecords(elderId: string): Promise<WalrusRecord[]>;
}

export interface PhotoStore {
  upload(path: string, file: File): Promise<void>;
  remove(paths: string[]): Promise<void>;
  signedUrls(paths: string[]): Promise<Record<string, string>>;
}

export interface Syncer {
  /** Mark pending now; perform the Walrus write after the response. */
  background(source: SyncSource): Promise<void>;
  /** Mark pending and perform the write before returning (used by Retry). */
  now(source: SyncSource): Promise<SyncOutcome | { status: "skipped"; reason: string }>;
}

export interface RecallHit {
  text: string;
  blobId: string;
  distance: number;
}

/** Semantic recall from one Walrus namespace (the Phase 1 MemoryService in production). */
export interface Recaller {
  recall(query: string, opts: { namespace: string; limit: number }): Promise<RecallHit[]>;
}

export interface Ctx {
  userId: string;
  repo: Repo;
  photos: PhotoStore;
  sync: Syncer;
  recall: Recaller;
}
