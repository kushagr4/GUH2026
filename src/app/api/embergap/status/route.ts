import { apiError, apiJson } from "@/features/embergap/api";
import { getEmbergapStatus } from "@/features/embergap/status";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/embergap/status: whether report submission and agent runs can work
 * on this deployment, for a signed-in user. Booleans and fixed text only: no
 * keys, no rows, no upstream error messages.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized", "Please sign in.");
  try {
    return apiJson(200, await getEmbergapStatus(await createClient(), user.id));
  } catch {
    return apiError(503, "unavailable", "The status check could not reach the database.");
  }
}
