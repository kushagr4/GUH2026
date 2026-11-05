import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgrest, toDbError, type DbResult } from "@/lib/db/result";
import type { Database, Tables } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
export type Profile = Pick<Tables<"profiles">, "id" | "display_name">;

/**
 * Reference for the repository pattern: small typed functions that take a client,
 * select only the columns they need, and return a DbResult.
 *
 * Profiles are created on first save rather than by a trigger on auth.users, so
 * this project needs no SECURITY DEFINER function.
 */
export async function getOwnProfile(
  client: Client,
  userId: string,
): Promise<DbResult<Profile | null>> {
  const { data, error } = await client
    .from("profiles")
    .select("id, display_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { ok: false, error: toDbError(error) };
  return { ok: true, data };
}

export async function saveOwnProfile(
  client: Client,
  userId: string,
  values: { display_name: string | null },
): Promise<DbResult<Profile>> {
  return fromPostgrest(
    await client
      .from("profiles")
      .upsert({ id: userId, ...values })
      .select("id, display_name")
      .single(),
  );
}
