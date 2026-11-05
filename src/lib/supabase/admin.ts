import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Privileged client that BYPASSES RLS. Nothing in the app uses it today.
 *
 * Only reach for it in server code with a real need (for example a webhook with
 * no user session), and check authorization yourself first. Most developers do
 * not have SUPABASE_SECRET_KEY, and it must never get a NEXT_PUBLIC_ prefix.
 */
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("SUPABASE_SECRET_KEY is not set on this server.");
  }
  const { url } = requireSupabaseEnv();
  return createSupabaseClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
