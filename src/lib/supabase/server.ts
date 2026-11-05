import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicSupabaseEnv } from "./env";

/** User-scoped Supabase client (RLS applies) for Server Components and Server Functions. */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = publicSupabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there. The
          // proxy refreshes the session on every request, so this is safe.
        }
      },
    },
  });
}

/** Verified user ID from the session JWT, or null. */
export async function getUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
}
