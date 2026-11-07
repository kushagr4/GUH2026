import "server-only";
import { idSchema, type InvestigationDetailResponse, type InvestigationReadRepository } from "@/lib/embergap/contracts";

export type InvestigationLookup =
  | { kind: "found"; data: InvestigationDetailResponse }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

/**
 * The investigation if the caller may see it. Invisible and nonexistent IDs
 * are both "not_found" (404), so callers can't probe which IDs exist. Access
 * control lives in the repository: Mac's runs under the caller's RLS; the
 * synthetic fixture one only holds synthetic investigations, which any
 * signed-in user may read.
 */
export async function getInvestigationDetail(
  id: string,
  repository: InvestigationReadRepository,
): Promise<InvestigationLookup> {
  if (!idSchema.safeParse(id).success) return { kind: "not_found" };
  const result = await repository.getInvestigationDetail(id);
  if (result.ok) return { kind: "found", data: result.data };
  return result.error.kind === "not_found" ? { kind: "not_found" } : { kind: "error", message: result.error.message };
}
