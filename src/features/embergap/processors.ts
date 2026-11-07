import { z } from "zod";
import {
  FIRMS_PROVENANCE,
  SOURCE_MAX_AGE_SECONDS,
  VISION_REQUIRED_LIMITATIONS,
  firmsEvidenceSchema,
  idSchema,
  sourceAvailabilitySchema,
  stableId,
  syntheticId,
  timestampSchema,
  type LimitationCode,
  type Observation,
  type Provenance,
} from "@/lib/embergap/contracts";
import { haversineKm } from "@/lib/embergap/agents/runtime/geo";
import { defineProcessor, type FindingDraft, type TaskProcessor } from "@/lib/embergap/agents/runtime/processors";
import { assessWitnessReports } from "@/lib/embergap/agents/validators/witness";
import { toCanonicalFinding } from "./adapters";

/**
 * Claude Mac's processors for the agent runtime (Claude PC, agents/runtime/**).
 * They plug in by kind, like Danil's, so the runtime itself is unchanged:
 *
 * - "satellite.firms": the satellite agent's reading of Outrolife's FIRMS
 *   result, fetched by the server BEFORE the task was queued.
 * - "witness.assess": the witness agent, running Danil's assessWitnessReports.
 * - "vision.unavailable": the vision agent's honest gap when no live vision
 *   model ran (none configured, no photo, or the model failed). It never
 *   invents a model result for a real photo.
 *
 * All are synchronous and pure, and return canonical records that the runtime
 * validates with the contract's schemas before anything replicates or persists.
 */

const recordId = (isSynthetic: boolean, name: string) => (isSynthetic ? syntheticId(name) : stableId(name));
const syntheticLimit = (isSynthetic: boolean): LimitationCode[] => (isSynthetic ? ["synthetic_data"] : []);

/* -------------------------------------------------------------------------- */
/* Satellite: NASA FIRMS                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How far from the public report point a detection counts as nearby: the
 * report's own uncertainty and public grid (about 1 km) plus a VIIRS pixel,
 * with room for the fire to have moved. Uncalibrated, like every threshold here.
 */
export const FIRMS_RADIUS_KM = 5;

export const firmsTaskInputSchema = z.object({
  product: z.string().trim().min(1).max(40),
  /** The adapter's own availability: "unavailable" carries its safe message. */
  availability: sourceAvailabilitySchema,
  /** The public (privacy-reduced) report point the search was centred on. */
  center: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
  radiusKm: z.number().positive().max(500),
  reportObservedAt: timestampSchema,
  detections: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        observedAt: timestampSchema,
        retrievedAt: timestampSchema,
        evidence: firmsEvidenceSchema,
        isSynthetic: z.boolean(),
      }),
    )
    .max(200),
});
export type FirmsTaskInput = z.infer<typeof firmsTaskInputSchema>;

const round1 = (value: number) => Math.round(value * 10) / 10;

export const firmsPassProcessor = defineProcessor({
  kind: "satellite.firms",
  input: firmsTaskInputSchema,
  run({ task, input, mode }) {
    const isSynthetic = mode === "synthetic";
    const investigationId = task.investigationId;
    const provenance: Provenance = { ...FIRMS_PROVENANCE, product: input.product, isSynthetic };
    const { availability } = input;
    const base = { investigationId, source: "firms" as const, retrievedAt: availability.checkedAt, provenance };
    const limitationNotes = [
      "A FIRMS detection is a satellite thermal anomaly, not a confirmed fire.",
      "No detection is not evidence that there is no fire: passes are hours apart and clouds or smoke can hide fire.",
    ];

    if (availability.state === "unavailable") {
      const observation: Observation = {
        ...base,
        id: recordId(isSynthetic, `firms/${investigationId}/${task.id}/unavailable`),
        sourceRecordId: null,
        observedAt: null,
        location: null,
        coverage: null,
        sourceState: "unavailable",
        evidence: null,
      };
      const reason = availability.message ?? "NASA FIRMS could not be reached.";
      const finding: FindingDraft = {
        assessment: "inconclusive",
        strength: null,
        reasonCodes: ["source_unavailable"],
        limitations: ["source_unavailable", "no_detection_is_not_absence", ...syntheticLimit(isSynthetic)],
        limitationNotes,
        evidenceIds: [observation.id],
        explanation: `${reason} Satellite evidence is unknown for this report, which is not evidence either way.`.slice(0, 2_000),
      };
      return { observations: [observation], findings: [finding] };
    }

    const reportAt = Date.parse(input.reportObservedAt);
    const maxAgeMs = SOURCE_MAX_AGE_SECONDS.firms * 1_000;
    const nearby = input.detections
      .map((detection) => ({
        detection,
        distanceKm: round1(haversineKm(input.center.latitude, input.center.longitude, detection.latitude, detection.longitude)),
      }))
      .filter((entry) => entry.distanceKm <= input.radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm || a.detection.id.localeCompare(b.detection.id))
      .slice(0, 20);
    const coverage =
      availability.windowStart && availability.windowEnd && availability.windowStart < availability.windowEnd
        ? { windowStart: availability.windowStart, windowEnd: availability.windowEnd, radiusKm: input.radiusKm }
        : null;

    if (nearby.length === 0) {
      const observation: Observation = {
        ...base,
        id: recordId(isSynthetic, `firms/${investigationId}/${task.id}/none`),
        sourceRecordId: null,
        observedAt: null,
        location: null,
        // A non-detection needs its coverage. Without one, it is a pass gap.
        coverage: coverage ?? { windowStart: new Date(reportAt - 24 * 3_600_000).toISOString(), windowEnd: availability.checkedAt, radiusKm: input.radiusKm },
        sourceState: "not_observed",
        evidence: null,
      };
      const window = `${observation.coverage!.windowStart} to ${observation.coverage!.windowEnd}`;
      const finding: FindingDraft = {
        assessment: "inconclusive",
        strength: null,
        reasonCodes: [coverage ? "no_thermal_detection_in_window" : "satellite_pass_gap"],
        limitations: ["no_detection_is_not_absence", ...syntheticLimit(isSynthetic)],
        limitationNotes,
        evidenceIds: [observation.id],
        explanation: `No ${input.product} thermal anomaly within ${input.radiusKm} km of the report between ${window}. That is unknown, not evidence that there is no fire.`,
      };
      return { observations: [observation], findings: [finding] };
    }

    const observations: Observation[] = nearby.map(({ detection, distanceKm }) => {
      const stale = Math.abs(Date.parse(detection.observedAt) - reportAt) > maxAgeMs;
      return {
        ...base,
        // Scoped to the investigation: one FIRMS pixel can sit near several reports.
        id: recordId(isSynthetic, `firms/${investigationId}/${detection.id}`),
        sourceRecordId: detection.id,
        observedAt: detection.observedAt,
        retrievedAt: detection.retrievedAt,
        location: { latitude: detection.latitude, longitude: detection.longitude },
        coverage,
        sourceState: stale ? ("stale" as const) : ("available" as const),
        evidence: { ...detection.evidence, distanceKm },
      };
    });
    const timely = observations.filter((observation) => observation.sourceState === "available");
    const nearest = nearby[0];
    if (timely.length === 0) {
      const finding: FindingDraft = {
        assessment: "inconclusive",
        strength: null,
        reasonCodes: ["source_stale"],
        limitations: ["source_stale", "low_spatial_precision", ...syntheticLimit(isSynthetic)],
        limitationNotes,
        evidenceIds: observations.map((observation) => observation.id),
        explanation: `${nearby.length} thermal anomaly detection(s) within ${input.radiusKm} km, the nearest ${nearest.distanceKm} km away, but none within ${SOURCE_MAX_AGE_SECONDS.firms / 3_600} hours of the reported time, so they may be a different event.`,
      };
      return { observations, findings: [finding] };
    }
    const confident = nearby.some(
      ({ detection, distanceKm }) =>
        distanceKm <= 2 && (detection.evidence.confidence === "high" || detection.evidence.confidence === "nominal" || (typeof detection.evidence.confidence === "number" && detection.evidence.confidence >= 50)),
    );
    const finding: FindingDraft = {
      assessment: "supports",
      strength: confident ? "moderate" : "weak",
      reasonCodes: ["thermal_anomaly_nearby"],
      limitations: ["low_spatial_precision", ...syntheticLimit(isSynthetic)],
      limitationNotes,
      evidenceIds: timely.map((observation) => observation.id),
      explanation: `${timely.length} ${input.product} thermal anomaly detection(s) within ${SOURCE_MAX_AGE_SECONDS.firms / 3_600} hours of the report, the nearest ${nearest.distanceKm} km from the report's approximate location (observed ${nearest.detection.observedAt}). A thermal anomaly is an observation, not a confirmed fire.`,
    };
    return { observations, findings: [finding] };
  },
});

/* -------------------------------------------------------------------------- */
/* Witness                                                                    */
/* -------------------------------------------------------------------------- */

export const witnessTaskInputSchema = z.object({
  reports: z
    .array(
      z.object({
        id: idSchema,
        reporterId: z.string().min(1).max(100),
        observedAt: timestampSchema,
        submittedAt: timestampSchema,
        /** The public, privacy-reduced point: the witness agent never needs the exact one. */
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        locationPrecisionM: z.number().min(0),
        /** Untrusted: compared for similarity only, never copied into a finding. */
        description: z.string().max(2_000),
        photoSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type WitnessTaskInput = z.infer<typeof witnessTaskInputSchema>;

export const REPORTER_OBSERVATION_PROVENANCE = (isSynthetic: boolean): Provenance => ({
  provider: isSynthetic ? "EmberGap synthetic scenario" : "EmberGap reporters",
  product: null,
  url: null,
  license: null,
  isSynthetic,
});

export const witnessProcessor = defineProcessor({
  kind: "witness.assess",
  input: witnessTaskInputSchema,
  run({ task, input, mode, nowIso }) {
    const isSynthetic = mode === "synthetic";
    const investigationId = task.investigationId;
    // One pointer per report, so the finding cites evidence this agent holds.
    const observations: Observation[] = input.reports.map((report) => ({
      id: recordId(isSynthetic, `human/${investigationId}/${report.id}`),
      investigationId,
      source: "human",
      sourceRecordId: report.id,
      observedAt: report.observedAt,
      retrievedAt: nowIso,
      location: { latitude: report.latitude, longitude: report.longitude },
      coverage: null,
      sourceState: "available",
      provenance: REPORTER_OBSERVATION_PROVENANCE(isSynthetic),
      evidence: { reportId: report.id, hasMedia: report.photoSha256 !== undefined },
    }));
    const assessment = assessWitnessReports(
      investigationId,
      input.reports.map((report) => ({ ...report, investigationId })),
      { now: () => nowIso, newId: () => "runtime-draft" },
    );
    const latest = [...input.reports].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id)).at(-1)!;
    const canonical = toCanonicalFinding(assessment.finding, { investigationId, reportId: latest.id, isSynthetic });
    const finding: FindingDraft = {
      reportId: latest.id,
      assessment: canonical.assessment,
      strength: canonical.strength,
      reasonCodes: canonical.reasonCodes,
      limitations: [...new Set<LimitationCode>([...canonical.limitations, "human_report_unverified"])],
      limitationNotes: canonical.limitationNotes,
      evidenceIds: observations.map((observation) => observation.id),
      explanation: canonical.explanation,
    };
    return { observations, findings: [finding] };
  },
});

/* -------------------------------------------------------------------------- */
/* Vision: an honest gap                                                      */
/* -------------------------------------------------------------------------- */

export const VISION_GAP_REASONS = {
  no_photo: "The report has no photo, so there is nothing for the vision agent to describe.",
  not_configured: "No live vision model is configured on this server, so the photo was not analysed.",
  model_failed: "The vision model did not answer in time, so the photo was not analysed.",
} as const;
export type VisionGapReason = keyof typeof VISION_GAP_REASONS;

export const visionGapInputSchema = z.object({
  reason: z.enum(Object.keys(VISION_GAP_REASONS) as [VisionGapReason, ...VisionGapReason[]]),
  mediaId: idSchema.nullable(),
});

export const visionGapProcessor = defineProcessor({
  kind: "vision.unavailable",
  input: visionGapInputSchema,
  run({ task, input, mode, nowIso }) {
    const isSynthetic = mode === "synthetic";
    const observation: Observation = {
      id: recordId(isSynthetic, `vision/${task.investigationId}/${task.id}/gap`),
      investigationId: task.investigationId,
      source: "vision",
      sourceRecordId: input.mediaId,
      observedAt: null,
      retrievedAt: nowIso,
      location: null,
      coverage: null,
      sourceState: "unavailable",
      provenance: { provider: "EmberGap vision validator", product: null, url: null, license: null, isSynthetic },
      evidence: null,
    };
    const finding: FindingDraft = {
      assessment: "inconclusive",
      strength: null,
      reasonCodes: [input.reason === "no_photo" ? "vision.no_photo" : "source_unavailable"],
      limitations: [...VISION_REQUIRED_LIMITATIONS, "source_unavailable", ...syntheticLimit(isSynthetic)],
      limitationNotes: [],
      evidenceIds: [observation.id],
      explanation: `${VISION_GAP_REASONS[input.reason]} That is a data gap, not evidence either way.`,
    };
    return { observations: [observation], findings: [finding] };
  },
});

export const MAC_PROCESSORS = {
  satellite: [firmsPassProcessor] as unknown as TaskProcessor<never>[],
  witness: [witnessProcessor] as unknown as TaskProcessor<never>[],
  vision: [visionGapProcessor] as unknown as TaskProcessor<never>[],
};
