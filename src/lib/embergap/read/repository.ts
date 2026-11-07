import "server-only";
import { createSupabaseReadRepository } from "@/features/embergap/read-repository";
import { getEmbergapViewer } from "@/features/embergap/viewer";
import type { InvestigationReadRepository } from "@/lib/embergap/contracts";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { fixtureReadRepository } from "./fixture-repository";

/**
 * The read repository both GET routes and the pages use.
 *
 * Claude Mac's Supabase-backed repository, created per request with the
 * caller's RLS-scoped client (never createAdminClient), so submitted reports
 * and the agents' findings appear here. Without Supabase or a signed-in viewer
 * it falls back to the labelled synthetic fixtures.
 */
export async function getReadRepository(): Promise<InvestigationReadRepository> {
  if (!isSupabaseConfigured()) return fixtureReadRepository;
  const viewer = await getEmbergapViewer();
  if (!viewer) return fixtureReadRepository;
  return createSupabaseReadRepository(await createClient(), viewer);
}
