import { z } from "zod";

/**
 * EmberGap shared contracts. Owned by Claude Mac (feat/embergap-core).
 *
 * Every shape that crosses a workstream boundary lives here: the report API
 * (d3vmakes and Mac), source observations (Claude PC and Outrolife), agent
 * findings and messages (Danil and Claude PC), and the map and investigation
 * read APIs (Outrolife). Import from "@/lib/embergap/contracts" and never copy
 * these types. To change one, ask Claude Mac, and bump CONTRACT_VERSION for any
 * breaking change.
 *
 * Conventions
 * - Timestamps are UTC ISO 8601 strings ending in "Z", as produced by
 *   `new Date().toISOString()`. Offsets such as "+01:00" are rejected.
 * - IDs are UUID strings (`crypto.randomUUID()`), stable across retries. For
 *   deterministic synthetic fixtures use `syntheticId("<owner>/<scenario>/<thing>")`.
 * - Coordinates are WGS 84 decimal degrees, latitude first, then longitude.
 * - Missing data is explicit: `null`, or a source state of "unavailable" or
 *   "not_observed". Never encode missing data as 0, an empty array of
 *   "negative" results, or a low score.
 *
 * Scientific limits these schemas enforce
 * - No satellite detection does not mean no wildfire: the satellite agent can
 *   never "contradict" a report, and "not_observed" must state its coverage.
 * - Weather is context, not proof: weather findings are "context" or
 *   "inconclusive" only.
 * - AI image analysis cannot verify a photograph's authenticity, location or
 *   time: vision findings must carry those three limitations.
 * - Software never confirms an incident: agents and fusion can only recommend
 *   "needs_human_review" or "insufficient_evidence". "reviewed" is set by an
 *   authorised human, and even that is not an official fire confirmation.
 * - Human reports stay "unverified" until reviewed.
 */

/** Bump on any breaking change, and tell every workstream. */
export const CONTRACT_VERSION = "2026-11-07.1";

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

export const idSchema = z.uuid();
export type Id = z.infer<typeof idSchema>;

/** UTC ISO 8601 with a trailing "Z". */
export const timestampSchema = z.iso.datetime();
export type Timestamp = z.infer<typeof timestampSchema>;

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const coordinatesSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});
export type Coordinates = z.infer<typeof coordinatesSchema>;

export const LOCATION_UNCERTAINTY_METERS = { min: 100, max: 50_000 } as const;

/**
 * Where the reporter believes the smoke or fire is, NOT where the reporter is
 * standing, with the radius they are confident about. Exact values are visible
 * only to the reporter and authorised reviewers.
 */
export const approximateLocationSchema = z.strictObject({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  uncertaintyMeters: z
    .number()
    .int()
    .min(LOCATION_UNCERTAINTY_METERS.min)
    .max(LOCATION_UNCERTAINTY_METERS.max),
});
export type ApproximateLocation = z.infer<typeof approximateLocationSchema>;

/** Human-derived public locations are snapped to this grid (about 1.1 km). */
export const PUBLIC_LOCATION_GRID_DEGREES = 0.01;
/** The smallest radius a human-derived public location may claim. */
export const PUBLIC_LOCATION_MIN_PRECISION_METERS = 1_000;

/**
 * A location that is safe to show anyone allowed to see the feature.
 * `precisionMeters` is the radius the point stands for. Human-derived points
 * come from `toPublicLocation`; public satellite points may be more precise.
 */
export const publicLocationSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  precisionMeters: z.number().int().positive(),
});
export type PublicLocation = z.infer<typeof publicLocationSchema>;

/** Rounds half away from zero, like Postgres `round(numeric, 2)`. */
function snapToGrid(value: number): number {
  const steps = Math.round(Math.abs(value) / PUBLIC_LOCATION_GRID_DEGREES);
  const snapped = Math.sign(value) * steps * PUBLIC_LOCATION_GRID_DEGREES;
  return Number(snapped.toFixed(2)) + 0; // "+ 0" turns -0 into 0
}

/** Coarsens a human-reported location for maps and shared views. */
export function toPublicLocation(location: Coordinates & { uncertaintyMeters?: number }): PublicLocation {
  return {
    latitude: Math.min(90, Math.max(-90, snapToGrid(location.latitude))),
    longitude: Math.min(180, Math.max(-180, snapToGrid(location.longitude))),
    precisionMeters: Math.max(
      PUBLIC_LOCATION_MIN_PRECISION_METERS,
      Math.round(location.uncertaintyMeters ?? 0),
    ),
  };
}

/** A map viewport. Boxes that cross the antimeridian are not supported. */
export const bboxSchema = z
  .object({
    minLongitude: longitudeSchema,
    minLatitude: latitudeSchema,
    maxLongitude: longitudeSchema,
    maxLatitude: latitudeSchema,
  })
  .refine((box) => box.minLongitude < box.maxLongitude && box.minLatitude < box.maxLatitude, {
    message: "Each minimum must be less than its maximum.",
  });
export type Bbox = z.infer<typeof bboxSchema>;

/** Parses the map query format "minLon,minLat,maxLon,maxLat". Returns null if invalid. */
export function parseBbox(value: string | null | undefined): Bbox | null {
  if (!value) return null;
  const parts = value.split(",");
  if (parts.length !== 4 || parts.some((part) => part.trim() === "")) return null;
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] = parts.map(Number);
  const parsed = bboxSchema.safeParse({ minLongitude, minLatitude, maxLongitude, maxLatitude });
  return parsed.success ? parsed.data : null;
}

/* -------------------------------------------------------------------------- */
/* Sources, agents, states and statuses                                       */
/* -------------------------------------------------------------------------- */

export const SOURCE_KINDS = ["human", "firms", "eonet", "weather", "vision"] as const;
export const sourceKindSchema = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof sourceKindSchema>;

/** The five runtime agents. These are software components, not authorities. */
export const AGENT_IDS = ["vision", "satellite", "weather", "witness", "fusion"] as const;
export const agentIdSchema = z.enum(AGENT_IDS);
export type AgentId = z.infer<typeof agentIdSchema>;

/**
 * "system" is report intake and the partition controller. It moves messages and
 * records facts; it never makes evidence decisions.
 */
export const messageEndpointSchema = z.enum([...AGENT_IDS, "system"]);
export type MessageEndpoint = z.infer<typeof messageEndpointSchema>;

export const eventActorSchema = z.enum([...AGENT_IDS, "system", "reporter", "reviewer"]);
export type EventActor = z.infer<typeof eventActorSchema>;

/**
 * - available: the source answered with data inside its freshness window.
 * - stale: data exists but is older than the freshness window.
 * - unavailable: the source failed, timed out or is not configured. Unknown,
 *   NOT negative evidence.
 * - not_observed: the source answered and has nothing for this place and time
 *   (for example no FIRMS detection). Also NOT evidence of absence.
 */
export const SOURCE_STATES = ["available", "stale", "unavailable", "not_observed"] as const;
export const sourceStateSchema = z.enum(SOURCE_STATES);
export type SourceState = z.infer<typeof sourceStateSchema>;

export const INVESTIGATION_STATUSES = [
  "unreviewed",
  "investigating",
  "needs_human_review",
  "insufficient_evidence",
  "reviewed",
] as const;
export const investigationStatusSchema = z.enum(INVESTIGATION_STATUSES);
export type InvestigationStatus = z.infer<typeof investigationStatusSchema>;

/** Statuses software may set. Only an authorised human reviewer sets "reviewed". */
export const AUTOMATED_INVESTIGATION_STATUSES = [
  "unreviewed",
  "investigating",
  "needs_human_review",
  "insufficient_evidence",
] as const satisfies readonly InvestigationStatus[];

/** A reviewer's judgement of the evidence. Never an official fire confirmation. */
export const REVIEW_OUTCOMES = ["supported", "not_supported", "duplicate", "inconclusive"] as const;
export const reviewOutcomeSchema = z.enum(REVIEW_OUTCOMES);
export type ReviewOutcome = z.infer<typeof reviewOutcomeSchema>;

/** How urgently a human should look. Not a probability, and not a severity. */
export const REVIEW_PRIORITIES = ["low", "medium", "high"] as const;
export const reviewPrioritySchema = z.enum(REVIEW_PRIORITIES);
export type ReviewPriority = z.infer<typeof reviewPrioritySchema>;

/* -------------------------------------------------------------------------- */
/* Provenance and freshness                                                   */
/* -------------------------------------------------------------------------- */

export const provenanceSchema = z.object({
  /** For example "NASA FIRMS", "Open-Meteo", "NASA EONET", "EmberGap reporter". */
  provider: z.string().trim().min(1).max(100),
  /** Dataset or product, for example "VIIRS_SNPP_NRT" or "forecast". */
  product: z.string().trim().min(1).max(100).nullable(),
  /** A documentation or record page. NEVER a request URL, which can contain an API key. */
  url: z.url({ protocol: /^https?$/ }).max(2_000).nullable(),
  license: z.string().trim().min(1).max(200).nullable(),
  isSynthetic: z.boolean(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/** Default freshness windows. A source older than this is "stale". */
export const SOURCE_MAX_AGE_SECONDS: Record<SourceKind, number> = {
  human: 7 * 24 * 3_600,
  firms: 12 * 3_600,
  eonet: 7 * 24 * 3_600,
  weather: 3 * 3_600,
  vision: 7 * 24 * 3_600,
};

/** Health of one source for a map view or an investigation. */
export const sourceAvailabilitySchema = z.object({
  source: sourceKindSchema,
  state: sourceStateSchema,
  /** When we last asked the source. */
  checkedAt: timestampSchema,
  /** The newest observation time we hold, or null if none. */
  latestObservedAt: timestampSchema.nullable(),
  maxAgeSeconds: z.number().int().positive(),
  /** Safe to show users. No keys, URLs with keys or raw upstream errors. */
  message: z.string().trim().min(1).max(300).nullable(),
});
export type SourceAvailability = z.infer<typeof sourceAvailabilitySchema>;

/**
 * Classifies data that the source returned. Use "unavailable" yourself when the
 * request failed: that is unknown, and this function cannot tell.
 */
export function classifyFreshness(input: {
  latestObservedAt: string | null;
  checkedAt: string;
  maxAgeSeconds: number;
}): Extract<SourceState, "available" | "stale" | "not_observed"> {
  if (input.latestObservedAt === null) return "not_observed";
  const ageMs = Date.parse(input.checkedAt) - Date.parse(input.latestObservedAt);
  return ageMs <= input.maxAgeSeconds * 1_000 ? "available" : "stale";
}

/* -------------------------------------------------------------------------- */
/* Observations (one source's data for one investigation)                     */
/* -------------------------------------------------------------------------- */

/** What was checked: needed to interpret "not_observed" honestly. */
export const observationCoverageSchema = z
  .object({
    windowStart: timestampSchema,
    windowEnd: timestampSchema,
    radiusKm: z.number().positive().max(500),
  })
  .refine((coverage) => Date.parse(coverage.windowStart) <= Date.parse(coverage.windowEnd), {
    message: "windowStart must not be after windowEnd.",
  });
export type ObservationCoverage = z.infer<typeof observationCoverageSchema>;

/** Thermal anomaly. A detection is an observation, not a confirmed fire. */
export const firmsEvidenceSchema = z.looseObject({
  instrument: z.string().trim().min(1).max(50).nullable(),
  satellite: z.string().trim().min(1).max(50).nullable(),
  /** FIRMS reports 0-100 for MODIS and low/nominal/high for VIIRS. */
  confidence: z.union([z.number().min(0).max(100), z.enum(["low", "nominal", "high"])]).nullable(),
  frpMegawatts: z.number().min(0).nullable(),
  brightnessKelvin: z.number().positive().nullable(),
  dayNight: z.enum(["day", "night"]).nullable(),
  distanceKm: z.number().min(0).nullable(),
});

export const weatherEvidenceSchema = z.looseObject({
  /** Whether the value was measured, modelled or forecast. */
  kind: z.enum(["observed", "modelled", "forecast"]),
  validAt: timestampSchema.nullable(),
  temperatureC: z.number().min(-90).max(70).nullable(),
  relativeHumidityPercent: z.number().min(0).max(100).nullable(),
  windSpeedKmh: z.number().min(0).max(500).nullable(),
  windDirectionDegrees: z.number().min(0).max(360).nullable(),
  precipitationMm: z.number().min(0).nullable(),
});

/** Curated natural-event context. Missing events are not a negative result. */
export const eonetEvidenceSchema = z.looseObject({
  eventId: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(300),
  categories: z.array(z.string().trim().min(1).max(100)).max(20),
  eventAt: timestampSchema.nullable(),
  closedAt: timestampSchema.nullable(),
  distanceKm: z.number().min(0).nullable(),
});

/** A pointer to the report. Report text and location stay in the report itself. */
export const humanEvidenceSchema = z.object({
  reportId: idSchema,
  hasMedia: z.boolean(),
});

/** Model-assisted description of a photo. Not authentication of the photo. */
export const visionEvidenceSchema = z.object({
  mediaId: idSchema,
  model: z.string().trim().min(1).max(100).nullable(),
  labels: z.array(z.string().trim().min(1).max(100)).max(30),
});

const observationBaseSchema = z.object({
  id: idSchema,
  investigationId: idSchema,
  /** The provider's own record ID, for de-duplication. */
  sourceRecordId: z.string().trim().min(1).max(200).nullable(),
  /** When the thing was observed. Null only for "unavailable" and "not_observed". */
  observedAt: timestampSchema.nullable(),
  /** When EmberGap fetched or received it. */
  retrievedAt: timestampSchema,
  location: coordinatesSchema.nullable(),
  coverage: observationCoverageSchema.nullable(),
  sourceState: sourceStateSchema,
  provenance: provenanceSchema,
});

export const observationSchema = z
  .discriminatedUnion("source", [
    observationBaseSchema.extend({ source: z.literal("firms"), evidence: firmsEvidenceSchema.nullable() }),
    observationBaseSchema.extend({ source: z.literal("weather"), evidence: weatherEvidenceSchema.nullable() }),
    observationBaseSchema.extend({ source: z.literal("eonet"), evidence: eonetEvidenceSchema.nullable() }),
    observationBaseSchema.extend({ source: z.literal("human"), evidence: humanEvidenceSchema.nullable() }),
    observationBaseSchema.extend({ source: z.literal("vision"), evidence: visionEvidenceSchema.nullable() }),
  ])
  .superRefine((observation, ctx) => {
    const hasData = observation.sourceState === "available" || observation.sourceState === "stale";
    if (hasData && observation.observedAt === null) {
      ctx.addIssue({ code: "custom", path: ["observedAt"], message: "Data needs an observation time." });
    }
    if (hasData && observation.evidence === null) {
      ctx.addIssue({ code: "custom", path: ["evidence"], message: "Data needs its evidence." });
    }
    if (observation.sourceState === "not_observed" && observation.coverage === null) {
      ctx.addIssue({
        code: "custom",
        path: ["coverage"],
        message: "Say what was checked: a non-detection without coverage is meaningless.",
      });
    }
  });
export type Observation = z.infer<typeof observationSchema>;

/* -------------------------------------------------------------------------- */
/* Agent findings                                                             */
/* -------------------------------------------------------------------------- */

/**
 * - supports / contradicts: this evidence points towards or away from the report.
 * - inconclusive: looked, could not tell.
 * - context: relevant background that cannot support or contradict on its own
 *   (weather, EONET).
 */
export const ASSESSMENTS = ["supports", "contradicts", "inconclusive", "context"] as const;
export const assessmentSchema = z.enum(ASSESSMENTS);
export type Assessment = z.infer<typeof assessmentSchema>;

/** Qualitative only. Never present it as a calibrated probability. */
export const EVIDENCE_STRENGTHS = ["weak", "moderate", "strong"] as const;
export const evidenceStrengthSchema = z.enum(EVIDENCE_STRENGTHS);
export type EvidenceStrength = z.infer<typeof evidenceStrengthSchema>;

/** snake_case, so codes stay machine-readable. Prefer the well-known codes below. */
export const reasonCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, "Use a snake_case reason code.");

/** Well-known reason codes. Agents may add their own snake_case codes. */
export const REASON_CODES = [
  "thermal_anomaly_nearby",
  "no_thermal_detection_in_window",
  "satellite_pass_gap",
  "smoke_like_features_visible",
  "no_smoke_like_features_visible",
  "image_unclear",
  "independent_reports_nearby",
  "possible_duplicate_report",
  "reports_inconsistent",
  "dry_or_windy_conditions",
  "recent_precipitation",
  "eonet_wildfire_event_nearby",
  "source_unavailable",
  "source_stale",
  "conflicting_evidence",
] as const;

/** Limits the UI must show next to a finding. */
export const LIMITATION_CODES = [
  "image_authenticity_unverifiable",
  "image_location_unverifiable",
  "image_time_unverifiable",
  "no_detection_is_not_absence",
  "weather_is_context_only",
  "source_unavailable",
  "source_stale",
  "low_spatial_precision",
  "possible_shared_origin",
  "model_output_uncalibrated",
  "synthetic_data",
] as const;
export const limitationCodeSchema = z.enum(LIMITATION_CODES);
export type LimitationCode = z.infer<typeof limitationCodeSchema>;

/** Every vision finding must carry these. */
export const VISION_REQUIRED_LIMITATIONS = [
  "image_authenticity_unverifiable",
  "image_location_unverifiable",
  "image_time_unverifiable",
] as const satisfies readonly LimitationCode[];

/** The fusion agent's advice to a human. It can never mark anything reviewed or confirmed. */
export const fusionRecommendationSchema = z.object({
  recommendedStatus: z.enum(["needs_human_review", "insufficient_evidence"]),
  reviewPriority: reviewPrioritySchema,
  supportingFindingIds: z.array(idSchema).max(100),
  contradictingFindingIds: z.array(idSchema).max(100),
  /** Plain-language gaps, for example "No FIRMS pass since 09:00 UTC". */
  evidenceGaps: z.array(z.string().trim().min(1).max(300)).max(20),
  possibleDuplicateReportIds: z.array(idSchema).max(50),
});
export type FusionRecommendation = z.infer<typeof fusionRecommendationSchema>;

export const agentFindingSchema = z
  .object({
    id: idSchema,
    investigationId: idSchema,
    agentId: agentIdSchema,
    createdAt: timestampSchema,
    /** Observation, report, media or finding IDs this finding is based on. */
    evidenceIds: z.array(idSchema).max(100),
    assessment: assessmentSchema,
    /** Null for "inconclusive" and "context". */
    strength: evidenceStrengthSchema.nullable(),
    reasonCodes: z.array(reasonCodeSchema).min(1).max(20),
    /** Plain language, shown to reviewers. Treat as untrusted text when rendering. */
    explanation: z.string().trim().min(1).max(2_000),
    limitations: z.array(limitationCodeSchema).max(20),
    /** Required for the fusion agent, null for everyone else. */
    recommendation: fusionRecommendationSchema.nullable(),
    isSynthetic: z.boolean(),
  })
  .superRefine((finding, ctx) => {
    if (finding.agentId === "satellite" && finding.assessment === "contradicts") {
      ctx.addIssue({
        code: "custom",
        path: ["assessment"],
        message: "No satellite detection is not evidence of no fire. Use inconclusive.",
      });
    }
    if (finding.agentId === "weather" && finding.assessment !== "context" && finding.assessment !== "inconclusive") {
      ctx.addIssue({ code: "custom", path: ["assessment"], message: "Weather is context, not proof." });
    }
    if (finding.agentId === "vision") {
      for (const required of VISION_REQUIRED_LIMITATIONS) {
        if (!finding.limitations.includes(required)) {
          ctx.addIssue({ code: "custom", path: ["limitations"], message: `Vision findings must include ${required}.` });
        }
      }
    }
    if (finding.agentId === "fusion" && finding.recommendation === null) {
      ctx.addIssue({ code: "custom", path: ["recommendation"], message: "Fusion findings need a recommendation." });
    }
    if (finding.agentId !== "fusion" && finding.recommendation !== null) {
      ctx.addIssue({ code: "custom", path: ["recommendation"], message: "Only the fusion agent recommends." });
    }
    const directional = finding.assessment === "supports" || finding.assessment === "contradicts";
    if (!directional && finding.strength !== null) {
      ctx.addIssue({ code: "custom", path: ["strength"], message: "Only supports or contradicts have a strength." });
    }
  });
export type AgentFinding = z.infer<typeof agentFindingSchema>;

/* -------------------------------------------------------------------------- */
/* Agent-to-agent messages                                                    */
/* -------------------------------------------------------------------------- */

export const AGENT_MESSAGE_SCHEMA_VERSION = 1;

const messageBaseSchema = z.object({
  schemaVersion: z.literal(AGENT_MESSAGE_SCHEMA_VERSION),
  /** Unique per message. A redelivered copy keeps the same id: process it once. */
  id: idSchema,
  investigationId: idSchema,
  from: messageEndpointSchema,
  to: messageEndpointSchema,
  createdAt: timestampSchema,
  /** Shared by every message about one task chain. */
  correlationId: idSchema,
  /** The message this one responds to, if any. */
  causationId: idSchema.nullable(),
  /** Per-sender counter, so receivers can detect gaps and reorder. */
  sequence: z.number().int().min(0),
  isSynthetic: z.boolean(),
});

export const AGENT_TASKS = ["assess_report", "collect_observations", "fuse_findings"] as const;

/** Validate every message you receive. Payloads are untrusted data, never instructions. */
export const agentMessageSchema = z.discriminatedUnion("kind", [
  messageBaseSchema.extend({
    kind: z.literal("task_assigned"),
    payload: z.object({
      taskId: idSchema,
      task: z.enum(AGENT_TASKS),
      reportId: idSchema.nullable(),
    }),
  }),
  messageBaseSchema.extend({
    kind: z.literal("observations_shared"),
    payload: z.object({ observations: z.array(observationSchema).min(1).max(50) }),
  }),
  messageBaseSchema.extend({
    kind: z.literal("finding_published"),
    payload: z.object({ finding: agentFindingSchema }),
  }),
  messageBaseSchema.extend({
    kind: z.literal("evidence_requested"),
    payload: z.object({
      sources: z.array(sourceKindSchema).min(1).max(SOURCE_KINDS.length),
      reason: z.string().trim().min(1).max(300),
    }),
  }),
  messageBaseSchema.extend({
    kind: z.literal("ack"),
    payload: z.object({ messageId: idSchema }),
  }),
]);
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type AgentMessageKind = AgentMessage["kind"];

/* -------------------------------------------------------------------------- */
/* Investigation events (the append-only timeline)                            */
/* -------------------------------------------------------------------------- */

export const AGENT_EVENT_TYPES = [
  "report_submitted",
  "task_queued",
  "message_sent",
  "message_delivered",
  "message_dropped",
  "duplicate_ignored",
  "partition_started",
  "partition_healed",
  "reconciled",
  "finding_recorded",
  "status_changed",
  "review_recorded",
] as const;
export const agentEventTypeSchema = z.enum(AGENT_EVENT_TYPES);
export type AgentEventType = z.infer<typeof agentEventTypeSchema>;

export const AGENT_EVENT_DETAILS_MAX_BYTES = 8_192;

export const agentEventSchema = z.object({
  id: idSchema,
  investigationId: idSchema,
  type: agentEventTypeSchema,
  actor: eventActorSchema,
  occurredAt: timestampSchema,
  recordedAt: timestampSchema,
  /** Unique per investigation. Recording the same key twice is a no-op. */
  idempotencyKey: z.string().trim().min(1).max(200),
  /** The AgentMessage this event is about, if any. */
  messageId: idSchema.nullable(),
  /** One line for the timeline. */
  summary: z.string().trim().min(1).max(300),
  details: z
    .record(z.string(), z.unknown())
    .nullable()
    .refine((details) => details === null || JSON.stringify(details).length <= AGENT_EVENT_DETAILS_MAX_BYTES, {
      message: `details must be at most ${AGENT_EVENT_DETAILS_MAX_BYTES} bytes of JSON.`,
    }),
  isSynthetic: z.boolean(),
});
export type AgentEvent = z.infer<typeof agentEventSchema>;

/* -------------------------------------------------------------------------- */
/* Report submission: POST /api/embergap/reports                              */
/* -------------------------------------------------------------------------- */

export const REPORT_DESCRIPTION_LENGTH = { min: 10, max: 2_000 } as const;
/** Reports may describe something seen up to this long ago. */
export const REPORT_MAX_AGE_HOURS = 72;
/** Allowed clock skew for observedAt in the future. */
export const REPORT_FUTURE_TOLERANCE_MS = 5 * 60_000;

/** Private bucket. Objects live at `<user id>/<media id>.<extension>`. */
export const REPORT_MEDIA_BUCKET = "embergap-report-media";
export const REPORT_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const REPORT_MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const reportMediaMimeTypeSchema = z.enum(REPORT_MEDIA_MIME_TYPES);
export type ReportMediaMimeType = z.infer<typeof reportMediaMimeTypeSchema>;
export const REPORT_MEDIA_EXTENSIONS: Record<ReportMediaMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * The only valid Storage path for a report photo. The browser uploads to it
 * with the signed-in user's client, then sends the mediaId in the report.
 */
export function reportMediaObjectPath(userId: string, mediaId: string, mimeType: ReportMediaMimeType): string {
  if (!idSchema.safeParse(userId).success || !idSchema.safeParse(mediaId).success) {
    throw new Error("reportMediaObjectPath needs UUIDs.");
  }
  return `${userId}/${mediaId}.${REPORT_MEDIA_EXTENSIONS[mimeType]}`;
}

/** A photo the browser has already uploaded to `reportMediaObjectPath(...)`. */
export const reportMediaUploadSchema = z.strictObject({
  mediaId: idSchema,
  mimeType: reportMediaMimeTypeSchema,
});
export type ReportMediaUpload = z.infer<typeof reportMediaUploadSchema>;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const reportDescriptionSchema = z
  .string()
  .trim()
  .min(REPORT_DESCRIPTION_LENGTH.min)
  .max(REPORT_DESCRIPTION_LENGTH.max)
  .refine((text) => !CONTROL_CHARACTERS.test(text), { message: "Remove control characters." });

/**
 * Body of POST /api/embergap/reports. Strict: unknown fields such as a
 * reporter ID, status or synthetic flag are rejected, because the server sets them.
 */
export const reportSubmissionRequestSchema = z
  .strictObject({
    /** Idempotency key from `crypto.randomUUID()`. Retrying with it returns the same report. */
    clientRequestId: idSchema,
    observedAt: timestampSchema,
    location: approximateLocationSchema,
    description: reportDescriptionSchema,
    media: reportMediaUploadSchema.nullable().default(null),
  })
  .superRefine((report, ctx) => {
    const observedAt = Date.parse(report.observedAt);
    const now = Date.now();
    if (observedAt > now + REPORT_FUTURE_TOLERANCE_MS) {
      ctx.addIssue({ code: "custom", path: ["observedAt"], message: "The observation time is in the future." });
    }
    if (observedAt < now - REPORT_MAX_AGE_HOURS * 3_600_000) {
      ctx.addIssue({
        code: "custom",
        path: ["observedAt"],
        message: `Reports must be about something seen in the last ${REPORT_MAX_AGE_HOURS} hours.`,
      });
    }
  });
export type ReportSubmissionRequest = z.infer<typeof reportSubmissionRequestSchema>;
/** What the browser sends (media may be omitted). */
export type ReportSubmissionInput = z.input<typeof reportSubmissionRequestSchema>;

/** 201 for a new report, 200 when clientRequestId matched an earlier one (`replayed: true`). */
export const reportSubmissionResponseSchema = z.object({
  reportId: idSchema,
  investigationId: idSchema,
  investigationStatus: investigationStatusSchema,
  mediaId: idSchema.nullable(),
  submittedAt: timestampSchema,
  /** Reports are claims. They stay unverified until a human reviews them. */
  verification: z.literal("unverified"),
  replayed: z.boolean(),
});
export type ReportSubmissionResponse = z.infer<typeof reportSubmissionResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Errors, shared by every EmberGap API                                       */
/* -------------------------------------------------------------------------- */

export const API_ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "payload_too_large",
  "rate_limited",
  "media_invalid",
  "conflict",
  "unavailable",
  "internal",
] as const;
export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/** `{ error: { code, message } }`. Messages are safe to show; they never contain raw database errors. */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1).max(500),
    /** Per-field messages for validation_failed, keyed by top-level field name. */
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    /** Set for rate_limited, matching the Retry-After header. */
    retryAfterSeconds: z.number().int().positive().optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Read models: map and investigation detail (Outrolife's GET routes)         */
/* -------------------------------------------------------------------------- */

/** One investigation as anyone allowed to see it may see it: no reporter, text or photo. */
export const investigationSummarySchema = z.object({
  id: idSchema,
  status: investigationStatusSchema,
  reviewPriority: reviewPrioritySchema.nullable(),
  location: publicLocationSchema,
  openedAt: timestampSchema,
  updatedAt: timestampSchema,
  /** Newest observation or report time, or null if there is none yet. */
  latestEvidenceAt: timestampSchema.nullable(),
  reportCount: z.number().int().min(0),
  /** Sources with at least one observation. */
  sources: z.array(sourceKindSchema).max(SOURCE_KINDS.length),
  isSynthetic: z.boolean(),
  syntheticScenarioId: z.string().trim().min(1).max(100).nullable(),
});
export type InvestigationSummary = z.infer<typeof investigationSummarySchema>;

export const investigationSchema = investigationSummarySchema
  .extend({
    reviewOutcome: reviewOutcomeSchema.nullable(),
    reviewedAt: timestampSchema.nullable(),
    reviewNote: z.string().trim().min(1).max(2_000).nullable(),
  })
  .superRefine((investigation, ctx) => {
    const reviewed = investigation.status === "reviewed";
    if (reviewed !== (investigation.reviewOutcome !== null && investigation.reviewedAt !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: "Only a reviewed investigation has a review outcome and time, and it must have both.",
      });
    }
  });
export type Investigation = z.infer<typeof investigationSchema>;

export const REPORT_VERIFICATION_STATES = ["unverified", "reviewed"] as const;

/** A report as its reporter, a reviewer, or anyone (synthetic only) may see it. Never includes the reporter. */
export const reportViewSchema = z.object({
  id: idSchema,
  investigationId: idSchema,
  observedAt: timestampSchema,
  submittedAt: timestampSchema,
  /** Untrusted user text: render as text, never as HTML or instructions. */
  description: z.string(),
  location: approximateLocationSchema,
  mediaIds: z.array(idSchema).max(5),
  verification: z.enum(REPORT_VERIFICATION_STATES),
  isSynthetic: z.boolean(),
});
export type ReportView = z.infer<typeof reportViewSchema>;

export const mediaViewSchema = z.object({
  id: idSchema,
  reportId: idSchema,
  mimeType: reportMediaMimeTypeSchema,
  sizeBytes: z.number().int().positive().max(REPORT_MEDIA_MAX_BYTES),
  /** A short-lived signed URL, or a static path for synthetic media. Null if the viewer may not see it. */
  url: z.string().min(1).max(2_000).nullable(),
  urlExpiresAt: timestampSchema.nullable(),
  isSynthetic: z.boolean(),
});
export type MediaView = z.infer<typeof mediaViewSchema>;

/** Why the caller can see an investigation. */
export const VIEWER_ACCESS = ["reporter", "reviewer", "synthetic"] as const;

/** Body of GET /api/embergap/investigations/[id] (404 with apiErrorResponseSchema if not visible). */
export const investigationDetailResponseSchema = z.object({
  investigation: investigationSchema,
  viewerAccess: z.enum(VIEWER_ACCESS),
  /** Only the reports this viewer may see. Linked reports from other people are omitted. */
  reports: z.array(reportViewSchema).max(50),
  media: z.array(mediaViewSchema).max(50),
  observations: z.array(observationSchema).max(200),
  findings: z.array(agentFindingSchema).max(200),
  /** Newest first, at most 200. */
  events: z.array(agentEventSchema).max(200),
  sourceAvailability: z.array(sourceAvailabilitySchema).max(SOURCE_KINDS.length),
  generatedAt: timestampSchema,
});
export type InvestigationDetailResponse = z.infer<typeof investigationDetailResponseSchema>;

export const MAP_DEFAULT_LIMIT = 50;
export const MAP_MAX_LIMIT = 200;

/** Query of GET /api/embergap/map?bbox=minLon,minLat,maxLon,maxLat&limit=50. No bbox means the whole world. */
export const mapQuerySchema = z.object({
  bbox: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === "") return null;
      const box = parseBbox(value);
      if (!box) {
        ctx.addIssue({ code: "custom", message: "bbox must be minLon,minLat,maxLon,maxLat." });
        return z.NEVER;
      }
      return box;
    }),
  limit: z.coerce.number().int().min(1).max(MAP_MAX_LIMIT).default(MAP_DEFAULT_LIMIT),
});
export type MapQuery = z.infer<typeof mapQuerySchema>;

export const MAP_FEATURE_KINDS = ["investigation", "thermal_anomaly", "context_event"] as const;

/** One map marker. Investigations use a coarsened `toPublicLocation`. */
export const mapFeatureSchema = z.object({
  id: idSchema,
  kind: z.enum(MAP_FEATURE_KINDS),
  location: publicLocationSchema,
  /** Set for investigations, and for anomalies or events linked to one. */
  investigationId: idSchema.nullable(),
  status: investigationStatusSchema.nullable(),
  reviewPriority: reviewPrioritySchema.nullable(),
  /** Newest evidence time for this feature, or null if unknown. */
  observedAt: timestampSchema.nullable(),
  freshness: sourceStateSchema,
  sources: z.array(sourceKindSchema).max(SOURCE_KINDS.length),
  provenance: provenanceSchema,
});
export type MapFeature = z.infer<typeof mapFeatureSchema>;

/** Body of GET /api/embergap/map. */
export const mapResponseSchema = z.object({
  /** "synthetic" when every feature is synthetic, "live" when none is. */
  mode: z.enum(["synthetic", "live", "mixed"]),
  generatedAt: timestampSchema,
  bbox: bboxSchema.nullable(),
  limit: z.number().int().min(1).max(MAP_MAX_LIMIT),
  /** True when more features matched than `limit`. */
  truncated: z.boolean(),
  features: z.array(mapFeatureSchema).max(MAP_MAX_LIMIT),
  sourceAvailability: z.array(sourceAvailabilitySchema).max(SOURCE_KINDS.length),
});
export type MapResponse = z.infer<typeof mapResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Synthetic demonstration data                                               */
/* -------------------------------------------------------------------------- */

/** Badge text for anything with isSynthetic: true. */
export const SYNTHETIC_DATA_LABEL = "Synthetic demo data";

/**
 * Shared labelled scenarios, so baseline and distributed runs use the same
 * fixtures. `groundTruth` is the label for evaluation only: never show it as
 * an agent output.
 */
export const SYNTHETIC_SCENARIOS = [
  { id: "corroborated-smoke", title: "Smoke report near a recent thermal anomaly", groundTruth: "fire" },
  { id: "misleading-photo", title: "Cloud photo reported as smoke", groundTruth: "no_fire" },
  { id: "missing-satellite-pass", title: "Credible report before any satellite pass", groundTruth: "fire" },
  { id: "weather-timeout", title: "Weather source times out", groundTruth: "fire" },
  { id: "repeated-witness", title: "One witness reports the same smoke twice", groundTruth: "fire" },
  { id: "partition-recovery", title: "Agents partitioned, then reconciled", groundTruth: "fire" },
] as const;
export type SyntheticScenarioId = (typeof SYNTHETIC_SCENARIOS)[number]["id"];
export const syntheticScenarioIdSchema = z.enum(
  SYNTHETIC_SCENARIOS.map((scenario) => scenario.id) as [SyntheticScenarioId, ...SyntheticScenarioId[]],
);

/** Synthetic IDs start with this group, so they are easy to spot in logs. */
export const SYNTHETIC_ID_PREFIX = "00000000-";

/** A small, deterministic string hash (cyrb53). Not cryptographic. */
function hash53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2_654_435_761);
    h2 = Math.imul(h2 ^ code, 1_597_334_677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909);
  return 4_294_967_296 * (2_097_151 & h2) + (h1 >>> 0);
}

/**
 * A stable UUID for synthetic fixtures, derived from a name. Use a name that is
 * unique to you, for example "firms/corroborated-smoke/detection-1". Works in
 * the browser and in Node.
 */
export function syntheticId(name: string): string {
  if (name.trim() === "") throw new Error("syntheticId needs a name.");
  const hex = (hash53(name, 1).toString(16).padStart(14, "0") + hash53(name, 2).toString(16).padStart(14, "0")).slice(0, 23);
  const variant = ((parseInt(hex[7], 16) & 0x3) | 0x8).toString(16);
  return `${SYNTHETIC_ID_PREFIX}${hex.slice(0, 4)}-4${hex.slice(4, 7)}-${variant}${hex.slice(8, 11)}-${hex.slice(11, 23)}`;
}

export function isSyntheticId(id: string): boolean {
  return id.startsWith(SYNTHETIC_ID_PREFIX) && idSchema.safeParse(id).success;
}
