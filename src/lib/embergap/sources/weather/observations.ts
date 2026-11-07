// Maps Open-Meteo context to the canonical Observation and SourceAvailability
// shapes in @/lib/embergap/contracts. Pure, so tests and the runtime use it.
//
// The contract wants one reading per observation, labelled "modelled" or
// "forecast" (Open-Meteo has no station observations), and precipitation as
// the total for the 24 hours ending at validAt. We emit the hourly reading
// nearest the time of interest; that total is null unless all 24 hours exist.
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
} from "@/lib/embergap/contracts";
import type { WeatherContext, WeatherReading } from "./types";

const HOUR_MS = 3_600_000;

/** Sum of hourly precipitation over the 24 hours ending at `validAt`, or null if any hour is missing. */
export function precipitationLast24h(readings: readonly WeatherReading[], validAt: string): number | null {
  const end = Date.parse(validAt);
  const byTime = new Map(readings.map((reading) => [Date.parse(reading.validAt), reading.precipitationMm]));
  let total = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    const value = byTime.get(end - hour * HOUR_MS);
    if (value === undefined || value === null) return null;
    total += value;
  }
  return Math.round(total * 100) / 100;
}

export function weatherObservations(
  context: WeatherContext,
  input: { investigationId: string },
): { observations: Observation[]; availability: SourceAvailability } {
  const isSynthetic = context.provenance.isSynthetic;
  const idFor = (name: string) => (isSynthetic ? syntheticId(`weather/${name}`) : stableId(`weather:${name}`));
  const readings = context.readings;
  const windowStart = readings.length ? readings[0].validAt : context.query.timeOfInterest;
  const lastReading = readings.length ? readings[readings.length - 1].validAt : null;
  const windowEnd =
    lastReading && Date.parse(lastReading) > Date.parse(windowStart)
      ? lastReading
      : new Date(Date.parse(windowStart) + HOUR_MS).toISOString();
  const coverage = { windowStart: toTimestamp(windowStart), windowEnd: toTimestamp(windowEnd), radiusKm: Math.max(1, context.gridCell?.distanceKm ?? 1) };
  const base = {
    investigationId: input.investigationId,
    source: "weather" as const,
    retrievedAt: toTimestamp(context.retrievedAt),
    provenance: context.provenance,
  };

  const nearest = context.nearest ? readings.find((reading) => reading.validAt === context.nearest?.validAt) : undefined;
  let observation: Observation;
  if (context.sourceState === "unavailable" || context.sourceState === "not_observed" || !nearest) {
    const state = context.sourceState === "unavailable" ? "unavailable" : "not_observed";
    observation = {
      ...base,
      id: idFor(`${input.investigationId}/${state}/${context.retrievedAt}`),
      sourceRecordId: null,
      observedAt: null,
      location: null,
      coverage: state === "not_observed" ? coverage : null,
      sourceState: state,
      evidence: null,
    };
  } else {
    const validAt = toTimestamp(nearest.validAt);
    observation = {
      ...base,
      id: idFor(`${input.investigationId}/${validAt}/${context.retrievedAt}`),
      // Includes the retrieval time: a later model run is a revision, not a duplicate.
      sourceRecordId: `open-meteo:${context.gridCell?.latitude},${context.gridCell?.longitude}:${validAt}@${context.retrievedAt}`,
      observedAt: validAt,
      location: context.gridCell ? { latitude: context.gridCell.latitude, longitude: context.gridCell.longitude } : null,
      coverage,
      sourceState: classifyFreshness({
        latestObservedAt: validAt,
        checkedAt: context.retrievedAt,
        maxAgeSeconds: SOURCE_MAX_AGE_SECONDS.weather,
        referenceAt: context.query.timeOfInterest,
      }),
      evidence: {
        kind: nearest.kind === "forecast" ? "forecast" : "modelled",
        validAt,
        temperatureC: nearest.temperatureC,
        relativeHumidityPercent: nearest.relativeHumidityPct,
        windSpeedKmh: nearest.windSpeedKmh,
        windDirectionDegrees: nearest.windDirectionDeg,
        precipitationMm: precipitationLast24h(readings, nearest.validAt),
      },
    };
  }

  const availability: SourceAvailability = {
    source: "weather",
    state: observation.sourceState,
    checkedAt: toTimestamp(context.retrievedAt),
    latestObservedAt: observation.observedAt,
    maxAgeSeconds: SOURCE_MAX_AGE_SECONDS.weather,
    windowStart: coverage.windowStart,
    windowEnd: coverage.windowEnd,
    message:
      observation.sourceState === "unavailable"
        ? (context.error?.message ?? "Open-Meteo could not be reached.")
        : observation.sourceState === "not_observed"
          ? "Open-Meteo returned no values for this place and time."
          : null,
  };
  return { observations: [observationSchema.parse(observation)], availability: sourceAvailabilitySchema.parse(availability) };
}
