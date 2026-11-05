import type { SupabaseClient } from "@supabase/supabase-js";
import { toPageRange } from "@/lib/db/pagination";
import { fromPostgrest, type DbResult } from "@/lib/db/result";
import type { Database, Tables } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
export type SmokeRecord = Pick<
  Tables<"dev_smoke_records">,
  "id" | "title" | "notes" | "created_at"
>;

const COLUMNS = "id, title, notes, created_at";

/**
 * Infrastructure smoke test only. Do not build product features on this table.
 * RLS scopes every query to the signed-in user, so no owner filter is needed.
 */
export async function listRecords(
  client: Client,
  page = 1,
): Promise<DbResult<SmokeRecord[]>> {
  const { from, to } = toPageRange({ page });
  return fromPostgrest(
    await client
      .from("dev_smoke_records")
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .range(from, to),
  );
}

export async function createRecord(
  client: Client,
  values: { title: string; notes?: string | null },
): Promise<DbResult<SmokeRecord>> {
  return fromPostgrest(
    await client
      .from("dev_smoke_records")
      .insert(values)
      .select(COLUMNS)
      .single(),
  );
}

export async function updateRecord(
  client: Client,
  id: string,
  values: { title: string },
): Promise<DbResult<SmokeRecord>> {
  return fromPostgrest(
    await client
      .from("dev_smoke_records")
      .update(values)
      .eq("id", id)
      .select(COLUMNS)
      .single(),
  );
}

export async function deleteRecord(
  client: Client,
  id: string,
): Promise<DbResult<{ id: string }>> {
  return fromPostgrest(
    await client
      .from("dev_smoke_records")
      .delete()
      .eq("id", id)
      .select("id")
      .single(),
  );
}
