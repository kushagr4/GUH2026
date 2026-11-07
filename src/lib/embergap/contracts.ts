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

/** Normalises a Date or a database timestamp ("...+00:00") to the contract's "Z" form. */
export function toTimestamp(value: string | Date): Timestamp {
  return new Date(value).toISOString();
}

export const latitudeSchema = z.number({ error: "Choose a point on the map." }).min(-90).max(90);
export const longitudeSchema = z.number({ error: "Choose a point on the map." }).min(-180).max(180);

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
const RADIUS_MESSAGE = "Choose a radius between 100 m and 50 km.";

export const approximateLocationSchema = z.strictObject(
  {
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    uncertaintyMeters: z
      .number({ error: RADIUS_MESSAGE })
      .int(RADIUS_MESSAGE)
      .min(LOCATION_UNCERTAINTY_METERS.min, RADIUS_MESSAGE)
      .max(LOCATION_UNCERTAINTY_METERS.max, RADIUS_MESSAGE),
  },
  { error: "Drop a pin where you saw the smoke." },
);
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

const onGrid = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

/**
 * A public location derived from a human report: snapped to the grid and at
 * least 1 km wide. Investigation summaries and investigation map markers must
 * use it, so the reporter's chosen point can never reach the map.
 */
export const humanPublicLocationSchema = publicLocationSchema.refine(
  (location) =>
    location.precisionMeters >= PUBLIC_LOCATION_MIN_PRECISION_METERS && onGrid(location.latitude) && onGrid(location.longitude),
  { message: "Use toPublicLocation() for human-derived locations." },
);

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

/* Report photos (constants used by several shapes below) */

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

/**
 * Statuses software may set: the fusion agent's recommendation, applied by the
 * runtime through EmberGapRuntimeStore.setAutomatedStatus. Only an authorised
 * human reviewer sets "reviewed", and software never changes a reviewed
 * investigation's status.
 */
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
/* Synthetic demonstration data                                               */
/* -------------------------------------------------------------------------- */

/** Badge text for anything with isSynthetic: true. */
export const SYNTHETIC_DATA_LABEL = "Synthetic demo data";

/**
 * Shared labelled scenarios, so baseline and distributed runs use the same
 * fixtures. Every workstream's fixtures for a scenario use its investigationId,
 * reportIds, place and time, which match the rows seeded by the migration
 * (syntheticId("core/<scenario>/investigation") and ".../report", or
 * ".../report-2"). Use owner-prefixed syntheticId names for everything else.
 * `groundTruth` is the evaluation label only: never show it as an agent output.
 */
export const SYNTHETIC_SCENARIOS = [
  {
    id: "corroborated-smoke",
    title: "Smoke report near a recent thermal anomaly",
    groundTruth: "fire",
    investigationId: "00000000-1923-4596-a095-774098c7d58b",
    reportIds: ["00000000-106e-47a9-a6eb-db11ac53887f"],
    report: { latitude: 53.546, longitude: -1.982, uncertaintyMeters: 500, observedAt: "2026-11-07T09:05:00.000Z" },
  },
  {
    id: "misleading-photo",
    title: "Cloud photo reported as smoke",
    groundTruth: "no_fire",
    investigationId: "00000000-09fe-4107-b776-6dd00f9c3170",
    reportIds: ["00000000-147e-4fbf-9e3e-fea1cf9c16c3"],
    report: { latitude: 53.625, longitude: -2.521, uncertaintyMeters: 1_000, observedAt: "2026-11-07T09:40:00.000Z" },
  },
  {
    id: "missing-satellite-pass",
    title: "Credible report before any satellite pass",
    groundTruth: "fire",
    investigationId: "00000000-0b9a-4749-91c0-8a00faa295dd",
    reportIds: ["00000000-0d26-4143-b8e1-aff19fe18752"],
    report: { latitude: 53.384, longitude: -1.872, uncertaintyMeters: 750, observedAt: "2026-11-07T10:15:00.000Z" },
  },
  {
    id: "weather-timeout",
    title: "Weather source times out",
    groundTruth: "fire",
    investigationId: "00000000-0d80-4774-bb4d-26102d4b14fe",
    reportIds: ["00000000-1fc0-4323-a8e3-55314f1a4833"],
    report: { latitude: 53.602, longitude: -1.931, uncertaintyMeters: 1_500, observedAt: "2026-11-07T10:50:00.000Z" },
  },
  {
    id: "repeated-witness",
    title: "One witness reports the same smoke twice",
    groundTruth: "fire",
    investigationId: "00000000-1653-4361-8829-3801c69d3012",
    reportIds: ["00000000-0318-4966-86dd-1d30955a62f6", "00000000-040f-47a7-a7ac-7ba099c9d49f"],
    report: { latitude: 53.913, longitude: -1.832, uncertaintyMeters: 500, observedAt: "2026-11-07T11:20:00.000Z" },
  },
  {
    id: "partition-recovery",
    title: "Agents partitioned, then reconciled",
    groundTruth: "fire",
    investigationId: "00000000-1146-409b-8d51-0ea14dfbfa8f",
    reportIds: ["00000000-0257-499c-9b8e-9c81906653c9"],
    report: { latitude: 53.462, longitude: -1.853, uncertaintyMeters: 1_000, observedAt: "2026-11-07T11:45:00.000Z" },
  },
] as const;

/**
 * The fixed "now" for synthetic runs: use it as checkedAt and retrievedAt, so
 * synthetic freshness doesn't depend on when the demo runs.
 */
export const SYNTHETIC_NOW = "2026-11-07T12:00:00.000Z";
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

/**
 * A stable UUID for real records that have none (a FIRMS row, an EONET event),
 * so the same record keeps the same ID across requests. Never synthetic-looking.
 * Example: stableId(`firms:${satellite}:${acqDate}:${acqTime}:${lat}:${lon}`).
 */
export function stableId(name: string): string {
  const id = syntheticId(name);
  const head = (hash53(name, 3) >>> 0).toString(16).padStart(8, "0").replace(/^0/, "1");
  return `${head}${id.slice(SYNTHETIC_ID_PREFIX.length - 1)}`;
}

/* -------------------------------------------------------------------------- */
/* Provenance and freshness                                                   */
/* -------------------------------------------------------------------------- */

export const provenanceSchema = z.object({
  /** For example "NASA FIRMS", "Open-Meteo", "NASA EONET", "EmberGap reporter". */
  provider: z.string().trim().min(1).max(100),
  /** Dataset or product, for example "VIIRS_SNPP_NRT" or "forecast". */
  product: z.string().trim().min(1).max(100).nullable(),
  /** A documentation or record page. NEVER a request URL: FIRMS puts its key in the path. */
  url: z
    .url({ protocol: /^https?$/ })
    .max(2_000)
    .refine((url) => !url.includes("?") && !KEY_LIKE.test(url), { message: "Use a documentation page, not a request URL." })
    .nullable(),
  license: z.string().trim().min(1).max(200).nullable(),
  isSynthetic: z.boolean(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/** Spread this into FIRMS observations and markers, then set product (for example "VIIRS_SNPP_NRT"). */
export const FIRMS_PROVENANCE = {
  provider: "NASA FIRMS",
  product: null,
  url: "https://firms.modaps.eosdis.nasa.gov/",
  license: "NASA Earth Science data, openly shared",
  isSynthetic: false,
} as const satisfies Provenance;

/**
 * Default freshness windows: evidence further than this from the time of
 * interest is "stale". An EONET event still open at that time counts as current.
 */
export const SOURCE_MAX_AGE_SECONDS: Record<SourceKind, number> = {
  human: 7 * 24 * 3_600,
  firms: 12 * 3_600,
  eonet: 7 * 24 * 3_600,
  weather: 3 * 3_600,
  vision: 7 * 24 * 3_600,
};

/** Health of one source for a map view or an investigation. */
/** FIRMS keys are 32 alphanumerics: anything that looks like one is refused. */
const KEY_LIKE = /[A-Za-z0-9]{32,}/;

export const sourceAvailabilitySchema = z
  .object({
    source: sourceKindSchema,
    state: sourceStateSchema,
    /** When we last asked the source. Omit sources that were never asked. */
    checkedAt: timestampSchema,
    /** The newest observation time we hold, or null if none. */
    latestObservedAt: timestampSchema.nullable(),
    maxAgeSeconds: z.number().int().positive(),
    /** For "not_observed": the time window that was checked, so "none" never reads as "no fire". */
    windowStart: timestampSchema.nullable().default(null),
    windowEnd: timestampSchema.nullable().default(null),
    /** Safe to show users. No keys, URLs with keys or raw upstream errors. */
    message: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .refine((text) => !KEY_LIKE.test(text), { message: "That looks like an API key." })
      .nullable(),
  })
  .superRefine((availability, ctx) => {
    if (availability.state === "not_observed" && (availability.windowStart === null || availability.windowEnd === null)) {
      ctx.addIssue({ code: "custom", path: ["windowStart"], message: "Say which time window found nothing." });
    }
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
  /**
   * The time the evidence must describe: the report's observedAt for an
   * investigation. Defaults to checkedAt, for live map views.
   */
  referenceAt?: string;
}): Extract<SourceState, "available" | "stale" | "not_observed"> {
  if (input.latestObservedAt === null) return "not_observed";
  const distanceMs = Math.abs(Date.parse(input.referenceAt ?? input.checkedAt) - Date.parse(input.latestObservedAt));
  return distanceMs <= input.maxAgeSeconds * 1_000 ? "available" : "stale";
}

/* -------------------------------------------------------------------------- */
/* Observations (one source's data for one investigation)                     */
/* -------------------------------------------------------------------------- */

/**
 * What was checked: needed to interpret "not_observed" honestly. windowEnd is
 * the latest time the source is known to have covered (for FIRMS, the last
 * satellite pass), never just the request time. If that is unknown, report the
 * reason code satellite_pass_gap rather than no_thermal_detection_in_window.
 */
export const observationCoverageSchema = z
  .object({
    windowStart: timestampSchema,
    windowEnd: timestampSchema,
    radiusKm: z.number().positive().max(500),
  })
  .refine((coverage) => Date.parse(coverage.windowStart) < Date.parse(coverage.windowEnd), {
    message: "windowStart must be before windowEnd.",
  });
export type ObservationCoverage = z.infer<typeof observationCoverageSchema>;

/**
 * Thermal anomaly. A detection is an observation, not a confirmed fire. Extra
 * provider fields are dropped: ask Mac to add one rather than passing it through.
 */
export const firmsEvidenceSchema = z.object({
  instrument: z.string().trim().min(1).max(50).nullable(),
  satellite: z.string().trim().min(1).max(50).nullable(),
  /**
   * FIRMS pixel detection confidence: MODIS sends a numeric string (use
   * Number(confidence)), VIIRS sends l/n/h (map to low/nominal/high). It is not
   * a probability of wildfire: never display it with "%".
   */
  confidence: z.union([z.number().min(0).max(100), z.enum(["low", "nominal", "high"])]).nullable(),
  frpMegawatts: z.number().min(0).nullable(),
  /** bright_ti4 for VIIRS, brightness for MODIS. */
  brightnessKelvin: z.number().positive().nullable(),
  /** daynight: D becomes "day", N becomes "night". */
  dayNight: z.enum(["day", "night"]).nullable(),
  /** From investigation.location (the public point), never from the private report point. */
  distanceKm: z.number().min(0).nullable(),
  /** Processing version, for example "2.0NRT". */
  version: z.string().trim().min(1).max(20).nullable().default(null),
  /** Pixel size along scan and track, in km: the detection's spatial precision. */
  scanKm: z.number().positive().nullable().default(null),
  trackKm: z.number().positive().nullable().default(null),
});

/**
 * For weather, the observation's observedAt equals validAt: the time the value
 * describes. Open-Meteo values are "modelled" or "forecast", never "observed".
 */
export const weatherEvidenceSchema = z.object({
  /** Whether the value was measured, modelled or forecast. */
  kind: z.enum(["observed", "modelled", "forecast"]),
  validAt: timestampSchema.nullable(),
  temperatureC: z.number().min(-90).max(70).nullable(),
  relativeHumidityPercent: z.number().min(0).max(100).nullable(),
  windSpeedKmh: z.number().min(0).max(500).nullable(),
  windDirectionDegrees: z.number().min(0).max(360).nullable(),
  /** Total for the 24 hours ending at validAt. */
  precipitationMm: z.number().min(0).nullable(),
});

/** Curated natural-event context. Missing events are not a negative result. */
export const eonetEvidenceSchema = z.object({
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

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "Use a lowercase hex SHA-256.");

/** Model-assisted description of a photo, emitted by the vision agent. Not authentication of the photo. */
export const visionEvidenceSchema = z.object({
  mediaId: idSchema,
  model: z.string().trim().min(1).max(100).nullable(),
  labels: z.array(z.string().trim().min(1).max(100)).max(30),
  /** Fingerprint of the exact bytes, for spotting the same photo in several reports. */
  contentSha256: sha256Schema.nullable(),
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
    if (!hasData && observation.evidence !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "No data means evidence: null. Never fill in zeros for a source that had nothing.",
      });
    }
    if (observation.sourceState === "unavailable" && observation.observedAt !== null) {
      ctx.addIssue({ code: "custom", path: ["observedAt"], message: "An unavailable source observed nothing." });
    }
    if (observation.source === "weather" && hasData && observation.evidence) {
      const { temperatureC, relativeHumidityPercent, windSpeedKmh, windDirectionDegrees, precipitationMm } =
        observation.evidence;
      const measured = [temperatureC, relativeHumidityPercent, windSpeedKmh, windDirectionDegrees, precipitationMm];
      if (measured.every((value) => value === null)) {
        ctx.addIssue({ code: "custom", path: ["evidence"], message: "Weather data needs at least one measurement." });
      }
    }
    if (
      observation.source === "human" &&
      observation.sourceRecordId !== null &&
      observation.sourceRecordId !== observation.evidence?.reportId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceRecordId"],
        message: "For human observations, sourceRecordId is null or the report ID, never a user ID.",
      });
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
 *   Always with a strength.
 * - inconclusive: looked, could not tell.
 * - context: relevant background that cannot support or contradict on its own
 *   (weather, EONET). Fusion findings are always "context": fusion's advice lives
 *   only in its recommendation, so it is never counted as more support.
 */
export const ASSESSMENTS = ["supports", "contradicts", "inconclusive", "context"] as const;
export const assessmentSchema = z.enum(ASSESSMENTS);
export type Assessment = z.infer<typeof assessmentSchema>;

/** Qualitative only. Never present it as a calibrated probability. */
export const EVIDENCE_STRENGTHS = ["weak", "moderate", "strong"] as const;
export const evidenceStrengthSchema = z.enum(EVIDENCE_STRENGTHS);
export type EvidenceStrength = z.infer<typeof evidenceStrengthSchema>;

const VERDICT_WORDS =
  /(^|[_.])(confirm|confirmed|confirms|verified|verify|authentic|certain|certainty|probability|percent|proof|proven)([_.]|$)/;

/**
 * snake_case, optionally namespaced by agent ("witness.single_report"), so codes
 * stay machine-readable. Prefer the well-known codes below. Codes that claim a
 * verdict ("fire_confirmed", "vision.image_authentic") are rejected.
 */
export const reasonCodeSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/, "Use a snake_case reason code, optionally agent-namespaced.")
  .refine((code) => code.length >= 2, { message: "Use a snake_case reason code." })
  .refine((code) => !VERDICT_WORDS.test(code), { message: "Reason codes describe evidence; they never claim a verdict." });

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
  "model_output_invalid",
  "unverifiable_claim_removed",
  "description_withheld",
  "human_report_unverified",
  "heuristic_thresholds_uncalibrated",
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
  /** "investigating" while evidence is still expected. Never "reviewed". */
  recommendedStatus: z.enum(["investigating", "needs_human_review", "insufficient_evidence"]),
  reviewPriority: reviewPrioritySchema,
  /** How many independent source types directly support the report. A count, not a probability. */
  independentSourceCount: z.number().int().min(0).default(0),
  supportingFindingIds: z.array(idSchema).max(100),
  contradictingFindingIds: z.array(idSchema).max(100),
  /** Plain-language gaps, for example "No FIRMS pass since 09:00 UTC". */
  evidenceGaps: z.array(z.string().trim().min(1).max(300)).max(20),
  possibleDuplicateReportIds: z.array(idSchema).max(50),
});
export type FusionRecommendation = z.infer<typeof fusionRecommendationSchema>;
/** What producers may send: defaulted fields are optional. */
export type FusionRecommendationInput = z.input<typeof fusionRecommendationSchema>;

export const agentFindingSchema = z
  .object({
    id: idSchema,
    investigationId: idSchema,
    /**
     * The report this finding assesses, or null for investigation-wide findings
     * (satellite, weather, fusion). A witness duplicate finding sets it to the
     * later report and lists the earlier one in evidenceIds. The newest finding
     * per (agentId, reportId) supersedes older ones; nothing is ever edited.
     */
    reportId: idSchema.nullable().default(null),
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
    /** Agent-specific caveats in plain language, shown beside the codes. */
    limitationNotes: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
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
    if (finding.agentId === "fusion" && (finding.assessment !== "context" || finding.strength !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["assessment"],
        message: "Fusion advice lives in recommendation only: use assessment 'context' and strength null.",
      });
    }
    if (finding.agentId !== "fusion" && finding.recommendation !== null) {
      ctx.addIssue({ code: "custom", path: ["recommendation"], message: "Only the fusion agent recommends." });
    }
    const directional = finding.assessment === "supports" || finding.assessment === "contradicts";
    const codes = new Set(finding.reasonCodes);
    const absenceCodes = ["no_thermal_detection_in_window", "satellite_pass_gap", "source_unavailable", "source_stale"];
    if (finding.assessment === "contradicts" && absenceCodes.some((code) => codes.has(code))) {
      ctx.addIssue({
        code: "custom",
        path: ["assessment"],
        message: "Missing, stale or absent data can't contradict a report.",
      });
    }
    const contextCodes = new Set(["dry_or_windy_conditions", "recent_precipitation", "eonet_wildfire_event_nearby"]);
    if (directional && finding.reasonCodes.every((code) => contextCodes.has(code))) {
      ctx.addIssue({
        code: "custom",
        path: ["assessment"],
        message: "Weather and EONET context alone can't support or contradict a report.",
      });
    }
    if ((codes.has("no_thermal_detection_in_window") || codes.has("satellite_pass_gap")) && !finding.limitations.includes("no_detection_is_not_absence")) {
      ctx.addIssue({ code: "custom", path: ["limitations"], message: "A non-detection must include no_detection_is_not_absence." });
    }
    if (finding.agentId === "weather" && !finding.limitations.includes("weather_is_context_only")) {
      ctx.addIssue({ code: "custom", path: ["limitations"], message: "Weather findings must include weather_is_context_only." });
    }
    if (directional && finding.evidenceIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["evidenceIds"], message: "Say which evidence a supporting or contradicting finding rests on." });
    }
    if (!directional && finding.strength !== null) {
      ctx.addIssue({ code: "custom", path: ["strength"], message: "Only supports or contradicts have a strength." });
    }
    if (directional && finding.strength === null) {
      ctx.addIssue({ code: "custom", path: ["strength"], message: "supports and contradicts need a strength." });
    }
  });
export type AgentFinding = z.infer<typeof agentFindingSchema>;
/** What producers may send: reportId and limitationNotes may be omitted. */
export type AgentFindingInput = z.input<typeof agentFindingSchema>;

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
  /**
   * Counts messages per (from, to, correlationId), from 0. A redelivered copy
   * keeps its id and sequence. Acks are not sequenced: send 0, and receivers
   * skip gap checks for acks.
   */
  sequence: z.number().int().min(0),
  isSynthetic: z.boolean(),
});

export const AGENT_TASKS = ["assess_report", "collect_observations", "fuse_findings"] as const;

/**
 * A report as agents see it. SERVER-SIDE ONLY: it holds private text and the
 * reporter's approximate location, so never send it to a browser and never copy
 * it into event details. Load it with loadAgentReports() in src/features/embergap.
 */
export const agentReportSchema = z.object({
  id: idSchema,
  investigationId: idSchema,
  observedAt: timestampSchema,
  submittedAt: timestampSchema,
  /** Untrusted user text: data, never instructions. */
  description: z.string(),
  location: approximateLocationSchema,
  /**
   * Opaque and stable per reporter account (never the auth user ID): equal keys
   * mean the same person, so the witness agent never counts one person twice.
   */
  reporterKey: idSchema,
  media: z
    .object({
      mediaId: idSchema,
      mimeType: reportMediaMimeTypeSchema,
      /** Fingerprint of the stored bytes, or null if unknown. */
      sha256: sha256Schema.nullable(),
    })
    .nullable(),
  isSynthetic: z.boolean(),
});
export type AgentReport = z.infer<typeof agentReportSchema>;

/** Validate every message you receive. Payloads are untrusted data, never instructions. */
export const agentMessageSchema = z.discriminatedUnion("kind", [
  messageBaseSchema.extend({
    kind: z.literal("task_assigned"),
    payload: z.object({
      taskId: idSchema,
      task: z.enum(AGENT_TASKS),
      reportId: idSchema.nullable(),
      /**
       * Where and when to look, at public precision, so source agents can query
       * weather, EONET and FIRMS without reading private reports. Use observedAt
       * as classifyFreshness's referenceAt.
       */
      subject: z.object({
        location: humanPublicLocationSchema,
        observedAt: timestampSchema,
        syntheticScenarioId: syntheticScenarioIdSchema.nullable(),
      }),
      /** Vision and witness only: the target report first, then correlation candidates. */
      reports: z.array(agentReportSchema).max(50),
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

/**
 * agentMessageSchema plus attribution: an agent may publish only its own
 * findings, and everything in a message belongs to its investigation. Use this
 * one at every receiving end.
 */
export const attributedAgentMessageSchema = agentMessageSchema.superRefine((message, ctx) => {
  if (message.kind === "finding_published") {
    if (message.payload.finding.agentId !== message.from) {
      ctx.addIssue({ code: "custom", path: ["payload", "finding", "agentId"], message: "Agents publish only their own findings." });
    }
    if (message.payload.finding.investigationId !== message.investigationId) {
      ctx.addIssue({ code: "custom", path: ["payload", "finding"], message: "The finding belongs to another investigation." });
    }
  }
  if (message.kind === "observations_shared") {
    message.payload.observations.forEach((observation, index) => {
      if (observation.investigationId !== message.investigationId) {
        ctx.addIssue({ code: "custom", path: ["payload", "observations", index], message: "The observation belongs to another investigation." });
      }
    });
  }
});
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

/*
 * Event details are shown to everyone who can see the investigation. Never put
 * report text, coordinates, photos, user IDs or upstream errors in them.
 *
 * Who records what: report intake records report_submitted (key
 * "report_submitted:<reportId>", done by the database) and task_queued
 * ("task_queued:<taskId>"). The runtime records every other type except
 * review_recorded, keyed "<type>:<id>[:<attempt>]". Partition events are
 * recorded once per in-flight investigation, keyed "<type>:<partitionId>".
 */

/** details of partition_started and partition_healed. */
export const partitionEventDetailsSchema = z.object({
  partitionId: idSchema,
  isolated: z.array(agentIdSchema).min(1),
});

/** details of reconciled: the numbers the partition demo shows. */
export const reconciledEventDetailsSchema = partitionEventDetailsSchema.extend({
  redelivered: z.number().int().min(0),
  duplicatesIgnored: z.number().int().min(0),
  completedWhileIsolated: z.number().int().min(0),
});

export const agentEventSchema = z
  .object({
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
  })
  .superRefine((event, ctx) => {
    if (event.type === "review_recorded" && event.actor !== "reviewer") {
      ctx.addIssue({ code: "custom", path: ["actor"], message: "Only a reviewer records a review." });
    }
    if (event.actor === "reporter" && event.type !== "report_submitted") {
      ctx.addIssue({ code: "custom", path: ["type"], message: "Reporters only submit reports." });
    }
    const detailsSchema =
      event.type === "reconciled"
        ? reconciledEventDetailsSchema
        : event.type === "partition_started" || event.type === "partition_healed"
          ? partitionEventDetailsSchema
          : null;
    if (detailsSchema && !detailsSchema.safeParse(event.details).success) {
      ctx.addIssue({ code: "custom", path: ["details"], message: `${event.type} needs its partition details.` });
    }
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

/**
 * The only valid Storage path for a report photo. Do not use ownerObjectPath.
 *
 * Browser flow (d3vmakes):
 * 1. Re-encode the photo first, which drops EXIF metadata such as GPS:
 *    createImageBitmap(file), draw it on a canvas (longest side at most 2048 px),
 *    then canvas.toBlob(..., "image/jpeg", 0.85). The API rejects photos that still
 *    carry EXIF or XMP. Apply REPORT_MEDIA_MAX_BYTES to the re-encoded blob.
 * 2. mediaId = crypto.randomUUID(). Take userId from requireUser() in the page
 *    (a Server Component) and pass it to the form as a prop, as
 *    src/app/dev/storage/page.tsx does.
 * 3. Upload with the browser client: storage.from(REPORT_MEDIA_BUCKET)
 *    .upload(reportMediaObjectPath(userId, mediaId, "image/jpeg"), blob,
 *    { contentType: "image/jpeg", upsert: false }). On a retry, an "already
 *    exists" error means it is already uploaded.
 * 4. POST the report with media: { mediaId, mimeType: "image/jpeg" }.
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
  .string({ error: "Describe what you saw." })
  .trim()
  .min(REPORT_DESCRIPTION_LENGTH.min, "Describe what you saw in at least 10 characters.")
  .max(REPORT_DESCRIPTION_LENGTH.max, "Keep the description under 2,000 characters.")
  .refine((text) => !CONTROL_CHARACTERS.test(text), { message: "Remove control characters." });

/** When it was seen: UTC, not in the future (5 minutes' grace), at most 72 hours ago. */
export const reportObservedAtSchema = z.iso.datetime({ error: "Enter when you saw it." }).superRefine((value, ctx) => {
  const observedAt = Date.parse(value);
  const now = Date.now();
  if (observedAt > now + REPORT_FUTURE_TOLERANCE_MS) {
    ctx.addIssue({ code: "custom", message: "That time is in the future." });
  }
  if (observedAt < now - REPORT_MAX_AGE_HOURS * 3_600_000) {
    ctx.addIssue({ code: "custom", message: `Reports must be about something seen in the last ${REPORT_MAX_AGE_HOURS} hours.` });
  }
});

/**
 * Body of POST /api/embergap/reports. Strict: unknown fields such as a
 * reporter ID, status or synthetic flag are rejected, because the server sets them.
 * The rules are per field, so `.pick()` and `.partial()` work for form steps.
 *
 * Retries: keep clientRequestId and mediaId for every retry of one submission,
 * and make new ones only after a 2xx response or for a new report. A known
 * clientRequestId always returns the stored report (200, replayed: true),
 * whatever the body. Errors:
 * - media_invalid: no valid photo at the path. Re-upload to the same path, or
 *   remove the photo, then retry with the same ids.
 * - conflict: that photo is already attached to another report. Use a new mediaId.
 * - validation_failed: fieldErrors holds z.flattenError(...).fieldErrors, keyed by
 *   top-level field; run this schema in the browser first for full paths.
 * - rate_limited: wait retryAfterSeconds.
 */
export const reportSubmissionRequestSchema = z.strictObject({
  /** Idempotency key from `crypto.randomUUID()`. */
  clientRequestId: idSchema,
  observedAt: reportObservedAtSchema,
  location: approximateLocationSchema,
  description: reportDescriptionSchema,
  media: reportMediaUploadSchema.nullable().default(null),
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
  /** A reviewer's judgement once status is "reviewed". "reviewed" alone never means confirmed. */
  reviewOutcome: reviewOutcomeSchema.nullable(),
  reviewPriority: reviewPrioritySchema.nullable(),
  location: humanPublicLocationSchema,
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
    if (investigation.reviewNote !== null && investigation.reviewOutcome === null) {
      ctx.addIssue({ code: "custom", path: ["reviewNote"], message: "A review note needs a review." });
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
}).superRefine((detail, ctx) => {
  if (detail.viewerAccess === "synthetic") {
    const real =
      !detail.investigation.isSynthetic ||
      detail.reports.some((report) => !report.isSynthetic) ||
      detail.media.some((media) => !media.isSynthetic);
    if (real) ctx.addIssue({ code: "custom", path: ["viewerAccess"], message: "A synthetic view can't contain real reports or photos." });
  }
  const visibleReports = new Set(detail.reports.map((report) => report.id));
  detail.media.forEach((media, index) => {
    if (!visibleReports.has(media.reportId)) {
      ctx.addIssue({ code: "custom", path: ["media", index], message: "Photos are listed only with a report the viewer can see." });
    }
    if (!media.isSynthetic && media.url !== null && media.urlExpiresAt === null) {
      ctx.addIssue({ code: "custom", path: ["media", index, "urlExpiresAt"], message: "Signed photo URLs must expire." });
    }
  });
  const visibleMedia = new Set(detail.media.map((media) => media.id));
  detail.observations.forEach((observation, index) => {
    if (observation.source === "human" && observation.evidence && !visibleReports.has(observation.evidence.reportId)) {
      ctx.addIssue({ code: "custom", path: ["observations", index], message: "Human observations are listed only with a visible report." });
    }
    if (observation.source === "vision" && observation.evidence && !visibleMedia.has(observation.evidence.mediaId)) {
      ctx.addIssue({ code: "custom", path: ["observations", index], message: "Vision observations are listed only with a visible photo." });
    }
  });
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
  /** Stable across requests. Investigations use their UUID; FIRMS rows use stableId(...). */
  id: z.string().trim().min(1).max(200),
  kind: z.enum(MAP_FEATURE_KINDS),
  location: publicLocationSchema,
  /** Set for investigations, and for anomalies or events linked to one. */
  investigationId: idSchema.nullable(),
  status: investigationStatusSchema.nullable(),
  reviewOutcome: reviewOutcomeSchema.nullable(),
  reviewPriority: reviewPrioritySchema.nullable(),
  /** Newest evidence time for this feature, or null if unknown. */
  observedAt: timestampSchema.nullable(),
  freshness: sourceStateSchema,
  sources: z.array(sourceKindSchema).max(SOURCE_KINDS.length),
  provenance: provenanceSchema,
  /** For thermal anomalies: the detection's details. */
  firms: firmsEvidenceSchema.nullable().default(null),
  /** For investigation markers: the full public summary, for lists and popups. */
  investigation: investigationSummarySchema.nullable().default(null),
}).superRefine((feature, ctx) => {
  if (feature.kind === "investigation" && !humanPublicLocationSchema.safeParse(feature.location).success) {
    ctx.addIssue({ code: "custom", path: ["location"], message: "Investigation markers use toPublicLocation()." });
  }
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
}).superRefine((response, ctx) => {
  if (response.features.length === 0) return;
  const synthetic = response.features.filter((feature) => feature.provenance.isSynthetic).length;
  const expected = synthetic === response.features.length ? "synthetic" : synthetic === 0 ? "live" : "mixed";
  if (response.mode !== expected) ctx.addIssue({ code: "custom", path: ["mode"], message: `mode must be "${expected}".` });
});
export type MapResponse = z.infer<typeof mapResponseSchema>;

/** The right `mode` for a list of map features. */
export function mapModeFor(features: readonly MapFeature[]): MapResponse["mode"] {
  const synthetic = features.filter((feature) => feature.provenance.isSynthetic).length;
  if (synthetic === features.length) return "synthetic";
  return synthetic === 0 ? "live" : "mixed";
}

/* -------------------------------------------------------------------------- */
/* Ports (types only, so they cost nothing in a browser bundle)               */
/* -------------------------------------------------------------------------- */

/** One source adapter (FIRMS, Open-Meteo, EONET). It never throws: a failure is an "unavailable" observation. */
export type SourceAdapter = (input: {
  investigationId: Id;
  subject: { location: PublicLocation; observedAt: Timestamp; syntheticScenarioId: SyntheticScenarioId | null };
  checkedAt: Timestamp;
  signal?: AbortSignal;
}) => Promise<{ observations: Observation[]; availability: SourceAvailability }>;

/**
 * How the agent runtime persists its work. Write-only, so no worker can read a
 * peer's findings around a partition. Every method is idempotent by id or key.
 * Mac implements it over Supabase (service role); tests use an in-memory one.
 */
export interface EmberGapRuntimeStore {
  appendEvents(events: AgentEvent[]): Promise<void>;
  saveObservations(observations: Observation[]): Promise<void>;
  saveFinding(finding: AgentFinding): Promise<void>;
  setAutomatedStatus(
    investigationId: Id,
    status: (typeof AUTOMATED_INVESTIGATION_STATUSES)[number],
    reviewPriority: ReviewPriority | null,
  ): Promise<void>;
}

/**
 * The read side, used by GET /api/embergap/map and /investigations/[id]. Runs
 * under the caller's RLS, returns "Z" timestamps, sets viewerAccess itself, and
 * returns not_found for anything the caller may not see.
 */
export interface InvestigationReadRepository {
  listMapInvestigations(query: MapQuery): Promise<
    { ok: true; data: { features: MapFeature[]; truncated: boolean } } | { ok: false; error: { kind: string; message: string } }
  >;
  getInvestigationDetail(
    id: Id,
  ): Promise<{ ok: true; data: InvestigationDetailResponse } | { ok: false; error: { kind: string; message: string } }>;
}
