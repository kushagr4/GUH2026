import "server-only";
import { demoInvestigations } from "./demo-investigations";
import { approximateLocation } from "./geo";
import type { InvestigationDetail } from "./types";

/** Ids are short lowercase slugs or UUIDs. Anything else is simply not found. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidInvestigationId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/**
 * The investigation `id` if `user` may see it, otherwise null (the route turns
 * that into 404, so callers can't probe which ids exist).
 *
 * Today only the synthetic demo investigations exist. They hold no real
 * person's data, so any signed-in user may read them. When Claude Mac's
 * repository lands, real investigations must be read through it with the
 * request's RLS-scoped client (never createAdminClient), so access follows the
 * reporter/reviewer policies.
 */
export async function getInvestigationForUser(
  id: string,
  user: { id: string } | null,
  now: Date = new Date(),
): Promise<InvestigationDetail | null> {
  if (!user || !isValidInvestigationId(id)) return null;

  const found = demoInvestigations(now).find((item) => item.id === id);
  if (!found) return null;

  const location = approximateLocation(found.report.latitude, found.report.longitude);
  return {
    ...found,
    report: {
      ...found.report,
      latitude: location.latitude,
      longitude: location.longitude,
      locationPrecisionKm: location.precisionKm,
    },
  };
}
