import "server-only";
import type { InvestigationReadRepository, MapFeature } from "@/lib/embergap/contracts";
import { fixtureReadRepository } from "@/lib/embergap/read/fixture-repository";
import { getInvestigationDetail, listMapInvestigations, type EmbergapClient, type EmbergapViewer } from "./repository";

/**
 * The Supabase-backed read repository for Outrolife's GET routes (Claude Mac).
 * It runs under the caller's RLS client, so reporters see their own
 * investigations, reviewers see all, and everyone sees the synthetic ones.
 *
 * The labelled synthetic fixtures stay as a fallback, so the demo still works
 * if the hosted project is unreachable or its migrations are not applied yet:
 * map features are merged by id (database first), and a detail the database
 * doesn't have is looked up in the fixtures, which only hold synthetic IDs.
 */
export function createSupabaseReadRepository(client: EmbergapClient, viewer: EmbergapViewer): InvestigationReadRepository {
  return {
    async listMapInvestigations(query) {
      const [database, fixtures] = await Promise.all([listMapInvestigations(client, query), fixtureReadRepository.listMapInvestigations(query)]);
      if (!database.ok) {
        console.warn("[embergap] map read fell back to synthetic fixtures", { kind: database.error.kind });
        return fixtures;
      }
      const seen = new Set(database.data.features.map((feature) => feature.id));
      const extra: MapFeature[] = fixtures.ok ? fixtures.data.features.filter((feature) => !seen.has(feature.id)) : [];
      const features = [...database.data.features, ...extra];
      return {
        ok: true,
        data: { features: features.slice(0, query.limit), truncated: database.data.truncated || features.length > query.limit },
      };
    },

    async getInvestigationDetail(id) {
      const result = await getInvestigationDetail(client, viewer, id);
      if (result.ok) return result;
      const fixture = await fixtureReadRepository.getInvestigationDetail(id);
      if (fixture.ok) return fixture;
      return { ok: false, error: { kind: result.error.kind, message: "Investigation not found." } };
    },
  };
}
