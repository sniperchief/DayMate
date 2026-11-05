import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicSupabaseEnv, serviceRoleKey } from "./env";

let admin: SupabaseClient | undefined;

/**
 * Service-role client. BYPASSES RLS — used only by the Walrus sync module to
 * write `walrus_records`, always scoped by the verified caregiver ID.
 */
export function adminClient(): SupabaseClient {
  admin ??= createClient(publicSupabaseEnv().url, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
