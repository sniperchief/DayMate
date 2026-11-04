/**
 * Supabase configuration. The URL and publishable (anon) key are public by
 * design; the service-role key is server-only and must never be prefixed
 * with NEXT_PUBLIC_.
 */
export class SupabaseConfigError extends Error {
  constructor(missing: string[]) {
    super(`Missing Supabase configuration: ${missing.join(", ")}. See docs/PHASE2_SETUP.md.`);
    this.name = "SupabaseConfigError";
  }
}

/** Unset, blank, or still the .env.example placeholder. */
function read(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && !/YOUR_/.test(v) ? v : undefined;
}

export function publicSupabaseEnv(): { url: string; key: string } {
  const url = read("NEXT_PUBLIC_SUPABASE_URL");
  const key = read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"].filter(Boolean) as string[];
  if (missing.length) throw new SupabaseConfigError(missing);
  return { url: url!, key: key! };
}

export function serviceRoleKey(): string {
  const key = read("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new SupabaseConfigError(["SUPABASE_SERVICE_ROLE_KEY"]);
  return key;
}
