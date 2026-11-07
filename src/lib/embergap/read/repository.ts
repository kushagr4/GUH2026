import "server-only";
import type { InvestigationReadRepository } from "@/lib/embergap/contracts";
import { fixtureReadRepository } from "./fixture-repository";

/**
 * The read repository both GET routes and the pages use.
 *
 * INTEGRATION POINT: when Claude Mac's Supabase-backed repository lands in
 * `src/features/embergap/**`, return it here (created per request with the
 * caller's RLS-scoped client, never createAdminClient). Nothing else in the
 * read path needs to change.
 */
export async function getReadRepository(): Promise<InvestigationReadRepository> {
  return fixtureReadRepository;
}
