// Maps EONET context to the canonical Observation and SourceAvailability shapes
// in @/lib/embergap/contracts. Pure, so tests and the runtime use it directly.
import {
  SOURCE_MAX_AGE_SECONDS,
  classifyFreshness,
  observationSchema,
  sourceAvailabilitySchema,
  stableId,
  syntheticId,
  toTimestamp,
  type Observation,
  type SourceAvailability,
  type SourceState,
} from "@/lib/embergap/contracts";
import type { EonetContext } from "./types";

const STATE_RANK: Record<SourceState, number> = { available: 3, stale: 2, not_observed: 1, unavailable: 0 };

/**
 * One observation per matching record. No match is one `not_observed`
 * observation with the checked window (never "no fire"), and a failure is one
 * `unavailable` observation with no evidence.
 */
export function eonetObservations(
  context: EonetContext,
  input: { investigationId: string; timeOfInterest: string },
): { observations: Observation[]; availability: SourceAvailability } {
  const isSynthetic = context.provenance.isSynthetic;
  const idFor = (name: string) => (isSynthetic ? syntheticId(`eonet/${name}`) : stableId(`eonet:${name}`));
  const coverage = {
    windowStart: `${context.query.start}T00:00:00.000Z`,
    windowEnd: `${context.query.end}T23:59:59.999Z`,
    radiusKm: context.query.radiusKm,
  };
  const base = {
    investigationId: input.investigationId,
    source: "eonet" as const,
    retrievedAt: toTimestamp(context.retrievedAt),
    provenance: context.provenance,
  };

  let observations: Observation[];
  if (context.sourceState === "unavailable" || context.sourceState === "not_observed") {
    observations = [
      {
        ...base,
        id: idFor(`${input.investigationId}/${context.sourceState}/${context.retrievedAt}`),
        sourceRecordId: null,
        observedAt: null,
        location: null,
        coverage: context.sourceState === "not_observed" ? coverage : null,
        sourceState: context.sourceState,
        evidence: null,
      },
    ];
  } else {
    observations = context.matches.map((match) => {
      const eventAt = toTimestamp(match.nearestGeometryDate);
      const closedAt = match.event.closedAt ? toTimestamp(match.event.closedAt) : null;
      // An event still open at the time of interest counts as current.
      const openThen = closedAt === null || Date.parse(closedAt) >= Date.parse(input.timeOfInterest);
      const geometry = match.event.geometry.find((item) => item.date === match.nearestGeometryDate) ?? match.event.geometry[0];
      return {
        ...base,
        id: idFor(`${input.investigationId}/${match.event.id}`),
        sourceRecordId: match.event.id,
        observedAt: eventAt,
        location: { latitude: geometry.latitude, longitude: geometry.longitude },
        coverage,
        sourceState: openThen
          ? "available"
          : classifyFreshness({
              latestObservedAt: eventAt,
              checkedAt: context.retrievedAt,
              maxAgeSeconds: SOURCE_MAX_AGE_SECONDS.eonet,
              referenceAt: input.timeOfInterest,
            }),
        evidence: {
          eventId: match.event.id,
          title: match.event.title,
          categories: ["wildfires"],
          eventAt,
          closedAt,
          distanceKm: match.distanceKm,
        },
      };
    });
  }

  const best = observations.reduce<SourceState>(
    (state, observation) => (STATE_RANK[observation.sourceState] > STATE_RANK[state] ? observation.sourceState : state),
    "unavailable",
  );
  const times = observations.flatMap((observation) => (observation.observedAt ? [observation.observedAt] : []));
  const availability: SourceAvailability = {
    source: "eonet",
    state: best,
    checkedAt: toTimestamp(context.retrievedAt),
    latestObservedAt: times.length ? times.sort().at(-1)! : null,
    maxAgeSeconds: SOURCE_MAX_AGE_SECONDS.eonet,
    windowStart: coverage.windowStart,
    windowEnd: coverage.windowEnd,
    message:
      context.sourceState === "unavailable"
        ? (context.error?.message ?? "NASA EONET could not be reached.")
        : context.sourceState === "not_observed"
          ? "No EONET record matched. That is not evidence that there is no fire."
          : null,
  };
  // Validate against the shared contract, so a mapping slip fails here, not in a teammate's code.
  return {
    observations: observations.map((observation) => observationSchema.parse(observation)),
    availability: sourceAvailabilitySchema.parse(availability),
  };
}
