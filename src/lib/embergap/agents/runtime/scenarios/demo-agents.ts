// The four demo agents and their processors.
//
// - weather (Claude PC): Open-Meteo and NASA EONET context. The contract has no
//   separate EONET agent, so the weather agent carries both kinds of context.
// - satellite: a SYNTHETIC stand-in for FIRMS detections. Outrolife's FIRMS
//   adapter output replaces its task input; it never runs in live mode.
// - vision: the real vision validator (fusion/runtime-processors.ts): the
//   guardrails run on model output fetched by the server before the task is
//   queued. `visionStandIn` is kept only for comparison and old tests.
// - fusion: the real deterministic evidence fusion, re-run by `fusionOnEvidence`
//   once per distinct evidence set.
// Every processor is synchronous and pure, and returns canonical records that
// the agent validates with the contract's schemas before anything replicates.
import { z } from "zod";
import {
  FIRMS_PROVENANCE,
  VISION_REQUIRED_LIMITATIONS,
  idSchema,
  syntheticId,
  timestampSchema,
  type AgentId,
  type EmberGapRuntimeStore,
  type LimitationCode,
  type Observation,
} from "@/lib/embergap/contracts";
import { eonetObservations } from "@/lib/embergap/sources/eonet/observations";
import { eonetContextSchema } from "@/lib/embergap/sources/eonet/types";
import { weatherObservations } from "@/lib/embergap/sources/weather/observations";
import { weatherContextSchema, type WeatherContext } from "@/lib/embergap/sources/weather/types";
import { RuntimeAgent } from "../agent";
import {
  fusionOnEvidence,
  fusionProcessor,
  visionValidatorProcessor,
} from "@/lib/embergap/agents/fusion/runtime-processors";
import { defineProcessor, type EvidenceHook, type FindingDraft, type RuntimeMode, type TaskProcessor } from "../processors";

export const DEMO_AGENT_IDS = ["fusion", "satellite", "vision", "weather"] as const satisfies readonly AgentId[];
export type DemoAgentId = (typeof DEMO_AGENT_IDS)[number];

/** Uncalibrated, transparent heuristics for describing conditions. Never a fire verdict. */
export const FIRE_WEATHER_HEURISTICS = { dryBelowHumidityPercent: 30, windyFromKmh: 25, wetFromMm24h: 2 } as const;

const synthetic = (isSynthetic: boolean): LimitationCode[] => (isSynthetic ? ["synthetic_data"] : []);
const round1 = (value: number) => Math.round(value * 10) / 10;

function describeConditions(evidence: NonNullable<Extract<Observation, { source: "weather" }>["evidence"]>) {
  const { temperatureC, relativeHumidityPercent: humidity, windSpeedKmh: wind, precipitationMm: rain } = evidence;
  const dry = humidity !== null && humidity < FIRE_WEATHER_HEURISTICS.dryBelowHumidityPercent;
  const windy = wind !== null && wind >= FIRE_WEATHER_HEURISTICS.windyFromKmh;
  const wet = rain !== null && rain >= FIRE_WEATHER_HEURISTICS.wetFromMm24h;
  const reasonCodes = [...(dry || windy ? ["dry_or_windy_conditions"] : []), ...(wet ? ["recent_precipitation"] : [])];
  const parts = [
    temperatureC === null ? "temperature unknown" : `${round1(temperatureC)} °C`,
    humidity === null ? "humidity unknown" : `${Math.round(humidity)}% humidity`,
    wind === null ? "wind unknown" : `wind ${round1(wind)} km/h`,
    rain === null ? "24-hour rain unknown" : `${round1(rain)} mm of rain in the previous 24 hours`,
  ];
  const meaning =
    dry || windy
      ? "Dry or windy conditions like these can help a fire grow, but weather cannot confirm or rule out a fire."
      : "These conditions are less favourable to fire, which does not rule out a fire.";
  return { reasonCodes: reasonCodes.length ? reasonCodes : ["weather.conditions_unremarkable"], summary: parts.join(", "), meaning };
}

/** The weather agent's reading of one weather observation: context, never proof. */
export function weatherFinding(observation: Observation, lead: string): FindingDraft {
  const base = {
    strength: null,
    evidenceIds: [observation.id],
    limitationNotes: ["Open-Meteo values are weather-model output, not station measurements."],
  };
  const limitations: LimitationCode[] = ["weather_is_context_only", ...synthetic(observation.provenance.isSynthetic)];
  if (observation.source !== "weather" || observation.sourceState === "unavailable") {
    return { ...base, assessment: "inconclusive", reasonCodes: ["source_unavailable"], limitations: [...limitations, "source_unavailable"], explanation: `${lead}: weather data could not be retrieved. That is unknown, not evidence either way.` };
  }
  if (observation.sourceState === "not_observed" || !observation.evidence) {
    return { ...base, assessment: "inconclusive", reasonCodes: ["weather.no_values"], limitations, explanation: `${lead}: the weather source returned no values. That is unknown, not evidence either way.` };
  }
  const { reasonCodes, summary, meaning } = describeConditions(observation.evidence);
  const stale = observation.sourceState === "stale";
  return {
    ...base,
    assessment: stale ? "inconclusive" : "context",
    reasonCodes: stale ? ["source_stale", ...reasonCodes] : reasonCodes,
    limitations: [...limitations, "heuristic_thresholds_uncalibrated", ...(stale ? (["source_stale"] as const) : [])],
    explanation: `${lead} (${observation.evidence.kind}, ${observation.evidence.validAt}): ${summary}. ${meaning}`,
  };
}

const weatherInput = z.object({ context: weatherContextSchema });

export const weatherContextProcessor = defineProcessor({
  kind: "weather.context",
  input: weatherInput,
  run({ task, input }) {
    const { observations } = weatherObservations(input.context, { investigationId: task.investigationId });
    return { observations, findings: [weatherFinding(observations[0], "Model weather at the reported time")] };
  },
});

export const eonetContextProcessor = defineProcessor({
  kind: "eonet.context",
  input: z.object({ context: eonetContextSchema, timeOfInterest: timestampSchema }),
  run({ task, input }) {
    const { context } = input;
    const { observations } = eonetObservations(context, { investigationId: task.investigationId, timeOfInterest: input.timeOfInterest });
    const limitations: LimitationCode[] = ["weather_is_context_only", ...synthetic(context.provenance.isSynthetic)];
    const limitationNotes = [
      "EONET is a curated, non-exhaustive record of larger events, not a detection feed.",
      "The weather agent carries EONET context because the contract has no separate EONET agent.",
    ];
    const window = `${context.query.start} to ${context.query.end}`;
    let finding: FindingDraft;
    if (context.sourceState === "unavailable") {
      finding = { assessment: "inconclusive", strength: null, reasonCodes: ["source_unavailable"], limitations: [...limitations, "source_unavailable"], limitationNotes, evidenceIds: observations.map((item) => item.id), explanation: "NASA EONET could not be reached. That is unknown, not evidence either way." };
    } else if (context.sourceState === "not_observed") {
      finding = { assessment: "inconclusive", strength: null, reasonCodes: ["eonet.no_matching_record"], limitations: [...limitations, "no_detection_is_not_absence"], limitationNotes, evidenceIds: observations.map((item) => item.id), explanation: `No NASA EONET wildfire record within ${context.query.radiusKm} km between ${window}. EONET is not exhaustive, so this is not evidence that there is no fire.` };
    } else {
      const nearest = context.matches[0];
      const prescribed = context.matches.some((match) => match.event.prescribedBurnLikely);
      finding = {
        assessment: "context",
        strength: null,
        reasonCodes: ["eonet_wildfire_event_nearby"],
        limitations: [...limitations, "low_spatial_precision"],
        limitationNotes: prescribed ? [...limitationNotes, "At least one record looks like a prescribed (Rx) burn."] : limitationNotes,
        evidenceIds: observations.map((item) => item.id),
        explanation: `NASA EONET lists ${context.matches.length} wildfire record(s) within ${context.query.radiusKm} km between ${window}; the nearest, "${nearest.event.title}", is ${nearest.distanceKm} km away. That is context, not confirmation of this report.`,
      };
    }
    return { observations, findings: [finding] };
  },
});

/**
 * Describes the weather at a satellite detection's place and time. It waits
 * (`after`) for the satellite pass's complete result, which during a partition
 * may be on the other side of the cut.
 */
export const detectionContextProcessor = defineProcessor({
  kind: "weather.detection-context",
  input: weatherInput,
  run({ task, input, upstream }) {
    const detections = upstream.flatMap((result) =>
      result.observations.filter((item) => item.source === "firms" && item.evidence !== null && item.observedAt !== null),
    );
    const limitations: LimitationCode[] = ["weather_is_context_only", ...synthetic(input.context.provenance.isSynthetic)];
    if (detections.length === 0) {
      const failed = upstream.some((result) => result.status === "failed");
      return {
        findings: [
          {
            assessment: "inconclusive",
            strength: null,
            reasonCodes: [failed ? "source_unavailable" : "weather.no_detection_to_describe"],
            limitations: [...limitations, failed ? "source_unavailable" : "no_detection_is_not_absence"],
            evidenceIds: upstream.flatMap((result) => result.observations.map((item) => item.id)),
            explanation: failed
              ? "The satellite pass could not be assessed, so there is no detection to describe."
              : "The satellite pass had no detection to describe. No detection is not evidence of no fire.",
          },
        ],
      };
    }
    const latest = detections.reduce((a, b) => ((a.observedAt ?? "") >= (b.observedAt ?? "") ? a : b));
    const atDetection: WeatherContext = { ...input.context, query: { ...input.context.query, timeOfInterest: latest.observedAt ?? input.context.query.timeOfInterest } };
    const nearestReading = atDetection.readings.reduce<WeatherContext["readings"][number] | null>((best, reading) => {
      const distance = Math.abs(Date.parse(reading.validAt) - Date.parse(atDetection.query.timeOfInterest));
      return !best || distance < Math.abs(Date.parse(best.validAt) - Date.parse(atDetection.query.timeOfInterest)) ? reading : best;
    }, null);
    const { observations } = weatherObservations(
      nearestReading ? { ...atDetection, nearest: { validAt: nearestReading.validAt, offsetMinutes: 0, kind: nearestReading.kind } } : atDetection,
      { investigationId: task.investigationId },
    );
    const draft = weatherFinding(observations[0], `Model weather at the satellite detection (${latest.observedAt})`);
    return { observations, findings: [{ ...draft, evidenceIds: [...detections.map((item) => item.id), observations[0].id] }] };
  },
});

const coordinate = { latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) };

/** SYNTHETIC stand-in for FIRMS detections. Never runs in live mode. */
export const satellitePassStandIn = defineProcessor({
  kind: "satellite.pass",
  syntheticOnly: true,
  input: z.object({
    passId: z.string().regex(/^[a-z0-9-]{1,40}$/),
    satellite: z.string().max(50),
    instrument: z.string().max(50),
    windowStart: timestampSchema,
    windowEnd: timestampSchema,
    radiusKm: z.number().positive().max(500),
    detections: z
      .array(
        z.object({
          ...coordinate,
          acquiredAt: timestampSchema,
          frpMegawatts: z.number().min(0),
          brightnessKelvin: z.number().positive(),
          confidence: z.enum(["low", "nominal", "high"]),
          distanceKm: z.number().min(0),
        }),
      )
      .max(20),
  }),
  run({ task, input, nowIso }) {
    const coverage = { windowStart: input.windowStart, windowEnd: input.windowEnd, radiusKm: input.radiusKm };
    const provenance = { ...FIRMS_PROVENANCE, product: `${input.instrument} ${input.satellite} (synthetic stand-in)`, isSynthetic: true };
    const base = { investigationId: task.investigationId, source: "firms" as const, retrievedAt: nowIso, coverage, provenance };
    const observations: Observation[] = input.detections.length
      ? input.detections.map((detection, index) => ({
          ...base,
          id: syntheticId(`satellite/${task.investigationId}/${input.passId}/${index}`),
          sourceRecordId: `synthetic:${input.passId}:${index}`,
          observedAt: detection.acquiredAt,
          location: { latitude: detection.latitude, longitude: detection.longitude },
          sourceState: "available" as const,
          evidence: {
            instrument: input.instrument,
            satellite: input.satellite,
            confidence: detection.confidence,
            frpMegawatts: detection.frpMegawatts,
            brightnessKelvin: detection.brightnessKelvin,
            dayNight: "day" as const,
            distanceKm: detection.distanceKm,
            version: null,
            scanKm: null,
            trackKm: null,
          },
        }))
      : [{ ...base, id: syntheticId(`satellite/${task.investigationId}/${input.passId}/none`), sourceRecordId: null, observedAt: null, location: null, sourceState: "not_observed" as const, evidence: null }];
    const nearestKm = Math.min(...input.detections.map((detection) => detection.distanceKm));
    const finding: FindingDraft = input.detections.length
      ? {
          assessment: "supports",
          strength: nearestKm <= 2 ? "moderate" : "weak",
          reasonCodes: ["thermal_anomaly_nearby"],
          limitations: ["synthetic_data", "low_spatial_precision"],
          evidenceIds: observations.map((item) => item.id),
          explanation: `Satellite pass ${input.passId}: ${input.detections.length} thermal anomaly detection(s), the nearest ${nearestKm} km from the report. A thermal anomaly is an observation, not a confirmed fire.`,
        }
      : {
          assessment: "inconclusive",
          strength: null,
          reasonCodes: ["no_thermal_detection_in_window"],
          limitations: ["synthetic_data", "no_detection_is_not_absence"],
          evidenceIds: observations.map((item) => item.id),
          explanation: `Satellite pass ${input.passId}: no thermal anomaly in the window. No detection is not evidence of no fire.`,
        };
    return { observations, findings: [finding] };
  },
});

/** SYNTHETIC stand-in for Danil's vision validator. Never runs in live mode. */
export const visionStandIn = defineProcessor({
  kind: "vision.assess",
  syntheticOnly: true,
  input: z.object({ mediaId: idSchema, reportObservedAt: timestampSchema, labels: z.array(z.string().min(1).max(100)).max(30), smokeLike: z.boolean() }),
  run({ task, input, nowIso }) {
    const observation: Observation = {
      id: syntheticId(`vision/${task.investigationId}/${input.mediaId}`),
      investigationId: task.investigationId,
      source: "vision",
      sourceRecordId: input.mediaId,
      observedAt: input.reportObservedAt,
      retrievedAt: nowIso,
      location: null,
      coverage: null,
      sourceState: "available",
      provenance: { provider: "EmberGap vision stand-in", product: "synthetic", url: null, license: null, isSynthetic: true },
      evidence: { mediaId: input.mediaId, model: "synthetic-stand-in", labels: input.labels, contentSha256: null },
    };
    const limitations: LimitationCode[] = [...VISION_REQUIRED_LIMITATIONS, "synthetic_data", "model_output_uncalibrated"];
    const finding: FindingDraft = input.smokeLike
      ? { assessment: "supports", strength: "weak", reasonCodes: ["smoke_like_features_visible"], limitations, evidenceIds: [observation.id], explanation: "Synthetic stand-in for the vision validator: the photo shows smoke-like features. Image analysis cannot verify a photo's authenticity, location or time." }
      : { assessment: "inconclusive", strength: null, reasonCodes: ["image_unclear"], limitations, evidenceIds: [observation.id], explanation: "Synthetic stand-in for the vision validator: the photo is unclear." };
    return { observations: [observation], findings: [finding] };
  },
});

export const DEFAULT_DEMO_PROCESSORS: Record<DemoAgentId, readonly TaskProcessor<never>[]> = {
  weather: [weatherContextProcessor, eonetContextProcessor, detectionContextProcessor] as unknown as TaskProcessor<never>[],
  satellite: [satellitePassStandIn] as unknown as TaskProcessor<never>[],
  vision: [visionValidatorProcessor] as unknown as TaskProcessor<never>[],
  fusion: [fusionProcessor] as unknown as TaskProcessor<never>[],
};

/** Default evidence hooks: fusion re-runs whenever its local evidence set changes. */
export const DEFAULT_DEMO_ON_EVIDENCE: Partial<Record<DemoAgentId, EvidenceHook>> = {
  fusion: fusionOnEvidence,
};

export type DemoAgentOptions = {
  runId: string;
  mode?: RuntimeMode;
  store?: EmberGapRuntimeStore;
  epochIso?: string;
  /** Per agent: processors that replace the default with the same kind, or add new kinds. */
  processors?: Partial<Record<DemoAgentId, readonly TaskProcessor<never>[]>>;
  /** Per agent: evidence-driven work, for example Danil's fusion re-runs. */
  onEvidence?: Partial<Record<DemoAgentId, EvidenceHook>>;
};

/** Builds the four agents for a run. Each is independent; they share nothing but the network. */
export function createDemoAgents(options: DemoAgentOptions): RuntimeAgent[] {
  const mode = options.mode ?? "synthetic";
  return DEMO_AGENT_IDS.map((id) => {
    const custom = options.processors?.[id] ?? [];
    const kinds = new Set(custom.map((processor) => processor.kind));
    const defaults = DEFAULT_DEMO_PROCESSORS[id].filter((processor) => !kinds.has(processor.kind) && !(mode === "live" && processor.syntheticOnly));
    return new RuntimeAgent({
      id,
      runId: options.runId,
      peers: DEMO_AGENT_IDS.filter((peer) => peer !== id),
      processors: [...defaults, ...custom],
      onEvidence: options.onEvidence?.[id] ?? DEFAULT_DEMO_ON_EVIDENCE[id],
      store: options.store,
      mode,
      epochIso: options.epochIso,
    });
  });
}
