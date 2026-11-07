import "server-only";
import { SYNTHETIC_SCENARIOS, type InvestigationReadRepository } from "@/lib/embergap/contracts";
import { fixtureReadRepository } from "@/lib/embergap/read/fixture-repository";
import { getInvestigationDetail, listMapInvestigations, type EmbergapClient, type EmbergapViewer } from "./repository";

const SYNTHETIC_IDS = new Set<string>(SYNTHETIC_SCENARIOS.map((scenario) => scenario.investigationId));

/**
 * The Supabase-backed read repository for the GET routes (Claude Mac). It runs
 * under the caller's RLS client, so reporters see their own investigations and
 * reviewers see all.
 *
 * The six synthetic demo investigations always come from the labelled Italy
 * fixtures: the hosted seed rows for those IDs predate the move to Italy and
 * still hold the old UK coordinates, and shared data is never edited to fix
 * that. Real (non-synthetic) investigations always come from the database.
 * If the database is unreachable, the fixtures are the fallback, and every
 * fixture record is marked isSynthetic, so nothing synthetic reads as live.
 */
export function createSupabaseReadRepository(client: EmbergapClient, viewer: EmbergapViewer): InvestigationReadRepository {
  return {
    async listMapInvestigations(query) {
      const [database, fixtures] = await Promise.all([listMapInvestigations(client, query), fixtureReadRepository.listMapInvestigations(query)]);
      if (!database.ok) {
        console.warn("[embergap] map read fell back to synthetic fixtures", { kind: database.error.kind });
        return fixtures;
      }
      const real = database.data.features.filter((feature) => !(feature.investigationId && SYNTHETIC_IDS.has(feature.investigationId)) && !feature.provenance.isSynthetic);
      const demo = fixtures.ok ? fixtures.data.features : [];
      const features = [...real, ...demo];
      return {
        ok: true,
        data: { features: features.slice(0, query.limit), truncated: database.data.truncated || features.length > query.limit },
      };
    },

    async getInvestigationDetail(id) {
      if (SYNTHETIC_IDS.has(id)) return fixtureReadRepository.getInvestigationDetail(id);
      const result = await getInvestigationDetail(client, viewer, id);
      if (result.ok) return result;
      return { ok: false, error: { kind: result.error.kind, message: "Investigation not found." } };
    },
  };
}
