import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicSupabaseEnv, serviceRoleKey } from "../src/lib/supabase/env";
import { loadEnv } from "./_cli";

/** Shared helpers for the live Supabase verification scripts. */
export function supabaseEnv() {
  loadEnv();
  return { ...publicSupabaseEnv(), serviceRole: serviceRoleKey() };
}

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };

export function admin(): SupabaseClient {
  const env = supabaseEnv();
  return createClient(env.url, env.serviceRole, noPersist);
}

export function anon(): SupabaseClient {
  const env = supabaseEnv();
  return createClient(env.url, env.key, noPersist);
}

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

/** Create a confirmed throwaway caregiver and return a client signed in as them. */
export async function createTestUser(label: string): Promise<TestUser> {
  const email = `daymate-test-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `Test ${label}` } });
  if (error || !data.user) throw new Error(`createUser(${label}) failed: ${error?.message}`);
  const client = anon();
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`signIn(${label}) failed: ${signIn.error.message}`);
  return { id: data.user.id, email, client };
}

export async function deleteTestUser(user: TestUser | undefined): Promise<void> {
  if (!user) return;
  const a = admin();
  const { data } = await a.storage.from("photos").list(user.id, { limit: 100 });
  for (const folder of data ?? []) {
    const { data: files } = await a.storage.from("photos").list(`${user.id}/${folder.name}`, { limit: 100 });
    const paths = (files ?? []).map((f) => `${user.id}/${folder.name}/${f.name}`);
    if (paths.length) await a.storage.from("photos").remove(paths);
  }
  await a.auth.admin.deleteUser(user.id); // cascades to all DayMate rows
}
