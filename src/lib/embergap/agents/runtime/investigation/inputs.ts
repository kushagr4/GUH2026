// Processors that accept PREPARED, canonical inputs, so a backend orchestrator
// can fetch upstream data first (Open-Meteo, EONET, FIRMS, Danil's
// validators) and then hand the results to independent agents. No processor
// here makes a request: they validate, interpret and cite.
//
//   weather.observations    canonical weather Observations      -> weather agent
//   eonet.observations      canonical EONET Observations         -> weather agent
//   satellite.observations  canonical FIRMS Observations         -> satellite agent
//   witness.findings        Danil's validated witness findings  -> witness agent
//   vision.assess           Danil's processor (agents/fusion/runtime-processors)
//   fusion.fuse             Danil's processor, re-run on new evidence
//
// A source that answered with nothing, or failed, arrives as availability with
// no observations; the processor records that as not_observed or unavailable,
// never as negative evidence.
import { z } from "zod";
import {
  FIRMS_PROVENANCE,
  SOURCE_MAX_AGE_SECONDS,
  agentFindingSchema,
  classifyFreshness,
  idSchema,
  observationSchema,
  sourceAvailabilitySchema,
  stableId,
  syntheticId,
  type LimitationCode,
  type Observation,
  type PublicLocation,
  type SourceAvailability,
} from "@/lib/embergap/contracts";
import type { FirmsResult } from "@/lib/embergap/sources/firms/types";
import { haversineKm } from "../geo";
import { defineProcessor, type FindingDraft, type ProcessorResult } from "../processors";
import { weatherFinding } from "../scenarios/demo-agents";

const sourceInput = (source: Observation["source"]) =>
  z
    .object({
      observations: z.array(observationSchema).max(50),
      availability: sourceAvailabilitySchema.nullable().optional(),
    })
    .refine((input) => input.observations.every((item) => item.source === source), { message: `Only ${source} observations.` })
    .refine((input) => input.observations.length > 0 || input.availability, { message: "Observations or availability are needed." });

const synthetic = (records: readonly { provenance: { isSynthetic: boolean } }[]): LimitationCode[] =>
  records.some((record) => record.provenance.isSynthetic) ? ["synthetic_data"] : [];

/**
 * When a source returned availability but no observations, one observation
 * records that state: "not_observed" with the checked window, or "unavailable".
 */
function observationsOrState(
  source: Observation["source"],
  investigationId: string,
  input: { observations: Observation[]; availability?: SourceAvailability | null },
  provenance: Observation["provenance"],
  radiusKm: number,
): Observation[] {
  const own = input.observations.filter((item) => item.investigationId === investigationId);
  if (own.length > 0 || !input.availability) return own;
  const availability = input.availability;
  const state = availability.state === "not_observed" ? "not_observed" : "unavailable";
  const name = `${source}/${investigationId}/${state}/${availability.checkedAt}`;
  const coverage =
    state === "not_observed" && availability.windowStart && availability.windowEnd
      ? { windowStart: availability.windowStart, windowEnd: availability.windowEnd, radiusKm }
      : null;
  return [
    observationSchema.parse({
      id: provenance.isSynthetic ? syntheticId(name) : stableId(name),
      investigationId,
      source,
      sourceRecordId: null,
      observedAt: null,
      retrievedAt: availability.checkedAt,
      location: null,
      coverage,
      sourceState: coverage ? "not_observed" : "unavailable",
      provenance,
      evidence: null,
    }),
  ];
}

const OPEN_METEO = { provider: "Open-Meteo", product: "forecast", url: "https://open-meteo.com/en/docs", license: "CC BY 4.0: Weather data by Open-Meteo.com", isSynthetic: false };
const EONET = { provider: "NASA EONET", product: "events v3", url: "https://eonet.gsfc.nasa.gov/docs/v3", license: null, isSynthetic: false };

/** "weather.observations": canonical weather observations to a context finding. */
export const weatherObservationsProcessor = defineProcessor({
  kind: "weather.observations",
  input: sourceInput("weather"),
  run({ task, input, mode }): ProcessorResult {
    const observations = observationsOrState("weather", task.investigationId, input, { ...OPEN_METEO, isSynthetic: mode === "synthetic" }, 1);
    const withData = observations.filter((item) => item.sourceState === "available" || item.sourceState === "stale");
    const primary = withData[0] ?? observations[0];
    return { observations, findings: primary ? [weatherFinding(primary, "Model weather at the reported time")] : [] };
  },
});

/** "eonet.observations": canonical EONET observations to a context finding. Never negative. */
export const eonetObservationsProcessor = defineProcessor({
  kind: "eonet.observations",
  input: sourceInput("eonet"),
  run({ task, input, mode }): ProcessorResult {
    const observations = observationsOrState("eonet", task.investigationId, input, { ...EONET, isSynthetic: mode === "synthetic" }, 50);
    const records = observations.filter((item) => item.source === "eonet" && item.evidence !== null);
    const limitations: LimitationCode[] = ["weather_is_context_only", ...synthetic(observations)];
    const limitationNotes = [
      "EONET is a curated, non-exhaustive record of larger events, not a detection feed.",
      "The weather agent carries EONET context because the contract has no separate EONET agent.",
    ];
    const evidenceIds = observations.map((item) => item.id);
    let finding: FindingDraft;
    if (records.length > 0) {
      const nearest = [...records].sort((a, b) => distance(a) - distance(b))[0];
      const evidence = nearest.source === "eonet" ? nearest.evidence : null;
      const stale = records.every((item) => item.sourceState === "stale");
      finding = {
        assessment: "context",
        strength: null,
        reasonCodes: stale ? ["eonet_wildfire_event_nearby", "source_stale"] : ["eonet_wildfire_event_nearby"],
        limitations: [...limitations, "low_spatial_precision", ...(stale ? (["source_stale"] as const) : [])],
        limitationNotes,
        evidenceIds,
        explanation: `NASA EONET lists ${records.length} wildfire record(s) near the report; the nearest, "${evidence?.title ?? "untitled"}", is ${evidence?.distanceKm ?? "an unknown distance in"} km away. That is context, not confirmation of this report.`,
      };
    } else if (observations.some((item) => item.sourceState === "not_observed")) {
      const coverage = observations.find((item) => item.coverage)?.coverage;
      finding = {
        assessment: "inconclusive",
        strength: null,
        reasonCodes: ["eonet.no_matching_record"],
        limitations: [...limitations, "no_detection_is_not_absence"],
        limitationNotes,
        evidenceIds,
        explanation: `No NASA EONET wildfire record${coverage ? ` within ${coverage.radiusKm} km between ${coverage.windowStart.slice(0, 10)} and ${coverage.windowEnd.slice(0, 10)}` : ""}. EONET is not exhaustive, so this is not evidence that there is no fire.`,
      };
    } else {
      finding = {
        assessment: "inconclusive",
        strength: null,
        reasonCodes: ["source_unavailable"],
        limitations: [...limitations, "source_unavailable"],
        limitationNotes,
        evidenceIds,
        explanation: "NASA EONET could not be reached. That is unknown, not evidence either way.",
      };
    }
    return { observations, findings: [finding] };
  },
});

function distance(observation: Observation): number {
  if (observation.source === "firms" || observation.source === "eonet") return observation.evidence?.distanceKm ?? Number.POSITIVE_INFINITY;
  return Number.POSITIVE_INFINITY;
}

/** "satellite.observations": canonical FIRMS observations. A non-detection is never negative. */
export const satelliteObservationsProcessor = defineProcessor({
  kind: "satellite.observations",
  input: sourceInput("firms"),
  run({ task, input, mode }): ProcessorResult {
    const provenance = { ...FIRMS_PROVENANCE, isSynthetic: mode === "synthetic" };
    const observations = observationsOrState("firms", task.investigationId, input, provenance, 10);
    const detections = observations.filter((item) => item.source === "firms" && item.evidence !== null && item.sourceState === "available");
    const stale = observations.filter((item) => item.source === "firms" && item.evidence !== null && item.sourceState === "stale");
    const limitations: LimitationCode[] = [...synthetic(observations)];
    const evidenceIds = observations.map((item) => item.id);
    let finding: FindingDraft;
    if (detections.length > 0) {
      const nearestKm = Math.min(...detections.map(distance));
      finding = {
        assessment: "supports",
        strength: nearestKm <= 2 ? "moderate" : "weak",
        reasonCodes: ["thermal_anomaly_nearby"],
        limitations: [...limitations, "low_spatial_precision"],
        evidenceIds: detections.map((item) => item.id),
        explanation: `${detections.length} satellite thermal anomaly detection(s)${Number.isFinite(nearestKm) ? `, the nearest ${Math.round(nearestKm * 10) / 10} km from the report` : ""}. A thermal anomaly is an observation, not a confirmed fire.`,
      };
    } else if (stale.length > 0) {
      finding = {
        assessment: "inconclusive",
        strength: null,
        reasonCodes: ["source_stale"],
        limitations: [...limitations, "source_stale", "no_detection_is_not_absence"],
        evidenceIds,
        explanation: "Satellite detections exist, but none near the reported time. That is unknown, not evidence either way.",
      };
    } else if (observations.some((item) => item.sourceState === "not_observed")) {
      const covered = observations.some((item) => item.coverage !== null);
      finding = {
        assessment: "inconclusive",
        strength: null,
        reasonCodes: [covered ? "no_thermal_detection_in_window" : "satellite_pass_gap"],
        limitations: [...limitations, "no_detection_is_not_absence"],
        evidenceIds,
        explanation: "No satellite thermal anomaly in the window checked. No detection is not evidence of no fire.",
      };
    } else {
      finding = {
        assessment: "inconclusive",
        strength: null,
        reasonCodes: ["source_unavailable"],
        limitations: [...limitations, "source_unavailable"],
        evidenceIds,
        explanation: "Satellite data could not be retrieved. That is unknown, not evidence either way.",
      };
    }
    return { observations, findings: [finding] };
  },
});

/**
 * "witness.findings": publishes witness findings Danil's validator already
 * produced (canonical, e.g. via Mac's toCanonicalFinding), so they travel to
 * the other agents like any evidence. Reports are cited by id; the report
 * text and location never enter the runtime.
 */
export const witnessFindingsProcessor = defineProcessor({
  kind: "witness.findings",
  input: z.object({
    findings: z.array(agentFindingSchema).min(1).max(20),
    /** The investigation's report ids, which the findings may cite. */
    reportIds: z.array(idSchema).max(50),
  }),
  run({ task, input }): ProcessorResult {
    const drafts: FindingDraft[] = input.findings
      .filter((finding) => finding.agentId === "witness" && finding.investigationId === task.investigationId)
      .map((finding) => ({
        assessment: finding.assessment,
        strength: finding.strength,
        reportId: finding.reportId,
        reasonCodes: finding.reasonCodes,
        explanation: finding.explanation,
        limitations: finding.limitations,
        limitationNotes: finding.limitationNotes,
        evidenceIds: finding.evidenceIds.filter((id) => input.reportIds.includes(id)),
      }));
    return { findings: drafts, references: input.reportIds };
  },
});

/**
 * Outrolife's FIRMS result (getThermalAnomalies) as canonical observations for
 * one investigation, with distances from its public location. Pure: the FIRMS
 * request already happened. Pass the result to "satellite.observations".
 */
export function firmsObservationsFor(
  result: FirmsResult,
  investigation: { investigationId: string; location: PublicLocation; observedAt: string; radiusKm?: number },
): { observations: Observation[]; availability: SourceAvailability } {
  const radiusKm = investigation.radiusKm ?? 10;
  const observations = result.detections
    .map((detection) => ({ detection, km: haversineKm(investigation.location.latitude, investigation.location.longitude, detection.latitude, detection.longitude) }))
    .filter(({ km }) => km <= radiusKm)
    .map(({ detection, km }) => {
      const name = `firms-observation/${investigation.investigationId}/${detection.id}`;
      return observationSchema.parse({
        id: detection.isSynthetic ? syntheticId(name) : stableId(name),
        investigationId: investigation.investigationId,
        source: "firms",
        sourceRecordId: detection.id,
        observedAt: detection.observedAt,
        retrievedAt: detection.retrievedAt,
        location: { latitude: detection.latitude, longitude: detection.longitude },
        coverage:
          result.availability.windowStart && result.availability.windowEnd
            ? { windowStart: result.availability.windowStart, windowEnd: result.availability.windowEnd, radiusKm }
            : null,
        sourceState: classifyFreshness({
          latestObservedAt: detection.observedAt,
          checkedAt: result.availability.checkedAt,
          maxAgeSeconds: SOURCE_MAX_AGE_SECONDS.firms,
          referenceAt: investigation.observedAt,
        }),
        provenance: { ...FIRMS_PROVENANCE, product: detection.product, isSynthetic: detection.isSynthetic },
        evidence: { ...detection.evidence, distanceKm: Math.round(km * 100) / 100 },
      });
    });
  // Detections exist but none near this investigation: the area was checked and had nothing here.
  const availability: SourceAvailability =
    observations.length === 0 && result.availability.state !== "unavailable"
      ? sourceAvailabilitySchema.parse({ ...result.availability, state: result.availability.windowStart ? "not_observed" : "unavailable", latestObservedAt: null })
      : result.availability;
  return { observations, availability };
}
