import {
  LOCATION_UNCERTAINTY_METERS,
  REPORT_MAX_AGE_HOURS,
  apiErrorResponseSchema,
  reportSubmissionRequestSchema,
  type ReportMediaUpload,
  type ReportSubmissionRequest,
} from "@/lib/embergap/contracts";

/** Radius choices offered in the form. All sit inside LOCATION_UNCERTAINTY_METERS. */
export const UNCERTAINTY_OPTIONS = [
  { value: 500, label: "Within 500 m" },
  { value: 1_000, label: "Within 1 km" },
  { value: 5_000, label: "Within 5 km" },
  { value: 10_000, label: "Within 10 km" },
].filter((option) => option.value >= LOCATION_UNCERTAINTY_METERS.min && option.value <= LOCATION_UNCERTAINTY_METERS.max);
export const DEFAULT_UNCERTAINTY_METERS = 1_000;

/** Exact coordinates beyond ~1 m add nothing; geolocation is coarser (~100 m) for privacy. */
export const COORDINATE_DECIMALS = 5;
export const GEOLOCATION_DECIMALS = 3;

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Field keys the form can attach a message to. */
export type ReportField = "latitude" | "longitude" | "uncertaintyMeters" | "location" | "observedAt" | "description" | "media" | "form";
export type ReportFieldErrors = Partial<Record<ReportField, string>>;

export type ReportFormValues = {
  latitude: string;
  longitude: string;
  uncertaintyMeters: number;
  /** A `datetime-local` value in the browser's time zone, e.g. "2026-11-07T15:30". */
  observedAtLocal: string;
  description: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** A Date as a `datetime-local` value in local time, to the minute. */
export function toDateTimeLocalValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` value (local time) as a UTC ISO string, or null if it isn't one. */
export function localDateTimeToUtcIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s || 0, 0);
  // Reject rollovers such as 2026-02-31.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Where the demo accepts reports. Configurable; the server does not enforce it.
 * Edges are inclusive.
 */
export const SERVICE_AREA = {
  name: "Italy",
  minLatitude: 35.4,
  maxLatitude: 47.1,
  minLongitude: 6.6,
  maxLongitude: 18.6,
  example: { latitude: 40.81, longitude: 14.5, label: "Terzigno vineyards, Vesuvius" },
} as const;
export const SERVICE_AREA_MESSAGE = `EmberGap currently covers ${SERVICE_AREA.name}. Enter a location in ${SERVICE_AREA.name}, for example ${SERVICE_AREA.example.latitude}, ${SERVICE_AREA.example.longitude} (${SERVICE_AREA.example.label}).`;

/** Same limit the server enforces (contract REPORT_MAX_AGE_HOURS), so the form never accepts what the API rejects. */
export const REPORT_MAX_AGE_MS = REPORT_MAX_AGE_HOURS * 3_600_000;
export const REPORT_MIN_DESCRIPTION_CHARS = 10;
/** The description counter turns to a warning at this share of the maximum. */
export const DESCRIPTION_WARNING_RATIO = 0.9;

export const MESSAGES = {
  description: "Add a few words about what you saw, e.g. smoke colour, size and direction (towards the vineyard, the road…).",
  observedAtMissing: "Enter when you saw it.",
  observedAtFuture: "That time is in the future.",
  observedAtTooOld: `Reports must be about something seen in the last ${REPORT_MAX_AGE_HOURS} hours.`,
  uncertainty: "Choose one of the listed distances.",
} as const;

/** The fields that validate inline, in the order the form shows them. */
export const VALIDATED_FIELDS = ["latitude", "longitude", "location", "uncertaintyMeters", "observedAt", "description"] as const;
export type ValidatedField = (typeof VALIDATED_FIELDS)[number];

const EXAMPLES = { latitude: SERVICE_AREA.example.latitude, longitude: SERVICE_AREA.example.longitude } as const;

/** Accepts "43.47" or "43,47" (Italian decimal comma); rejects more than one separator. */
export function parseCoordinate(raw: string, min: number, max: number, name: "latitude" | "longitude"): { value?: number; error?: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { error: `Enter a ${name}, or use your approximate location.` };
  if ((trimmed.match(/[.,]/g) ?? []).length > 1) {
    return { error: `Use a single decimal separator, e.g. ${EXAMPLES[name]}.` };
  }
  const normalised = trimmed.replace(",", ".");
  const value = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalised) ? Number(normalised) : Number.NaN;
  if (!Number.isFinite(value)) return { error: `Enter the ${name} as a number, e.g. ${EXAMPLES[name]}.` };
  if (value < min || value > max) return { error: `The ${name} must be between ${min} and ${max}.` };
  return { value: roundTo(value, COORDINATE_DECIMALS) };
}

export function isInServiceArea(latitude: number | undefined, longitude: number | undefined): boolean {
  const latOk = latitude === undefined || (latitude >= SERVICE_AREA.minLatitude && latitude <= SERVICE_AREA.maxLatitude);
  const lonOk = longitude === undefined || (longitude >= SERVICE_AREA.minLongitude && longitude <= SERVICE_AREA.maxLongitude);
  return latOk && lonOk;
}

function issueField(path: readonly PropertyKey[]): ReportField {
  const [head, sub] = path;
  if (head === "location") {
    if (sub === "latitude" || sub === "longitude" || sub === "uncertaintyMeters") return sub;
    return "location";
  }
  if (head === "observedAt" || head === "description" || head === "media") return head;
  return "form";
}

// Any valid UUID; only used to validate values before real ids exist.
const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";

function evaluate(values: ReportFormValues, ids: { clientRequestId: string; media: ReportMediaUpload | null }, now: Date) {
  const fieldErrors: ReportFieldErrors = {};

  const latitude = parseCoordinate(values.latitude, -90, 90, "latitude");
  const longitude = parseCoordinate(values.longitude, -180, 180, "longitude");
  if (latitude.error) fieldErrors.latitude = latitude.error;
  if (longitude.error) fieldErrors.longitude = longitude.error;
  // A valid coordinate on either axis outside the area is already a location problem.
  if ((latitude.value !== undefined || longitude.value !== undefined) && !isInServiceArea(latitude.value, longitude.value)) {
    fieldErrors.location = SERVICE_AREA_MESSAGE;
  }

  if (!UNCERTAINTY_OPTIONS.some((option) => option.value === values.uncertaintyMeters)) {
    fieldErrors.uncertaintyMeters = MESSAGES.uncertainty;
  }

  const observedAt = localDateTimeToUtcIso(values.observedAtLocal);
  if (!observedAt) fieldErrors.observedAt = MESSAGES.observedAtMissing;
  else if (Date.parse(observedAt) > now.getTime()) fieldErrors.observedAt = MESSAGES.observedAtFuture;
  else if (Date.parse(observedAt) < now.getTime() - REPORT_MAX_AGE_MS) fieldErrors.observedAt = MESSAGES.observedAtTooOld;

  const description = values.description.trim();
  // Whitespace-only counts as empty; spaces don't count towards the minimum.
  if (description.replace(/\s/g, "").length < REPORT_MIN_DESCRIPTION_CHARS) fieldErrors.description = MESSAGES.description;

  // The contract's own rules (72 h age, maximum length, control characters) fill any gaps.
  const parsed = reportSubmissionRequestSchema.safeParse({
    clientRequestId: ids.clientRequestId,
    observedAt: observedAt ?? "",
    location: {
      latitude: latitude.value ?? Number.NaN,
      longitude: longitude.value ?? Number.NaN,
      uncertaintyMeters: values.uncertaintyMeters,
    },
    description,
    media: ids.media,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fieldErrors[issueField(issue.path)] ??= issue.message;
  }
  return { fieldErrors, parsed };
}

/** Every client-side problem with the current values, keyed by field. */
export function collectFieldErrors(values: ReportFormValues, now: Date = new Date()): ReportFieldErrors {
  return evaluate(values, { clientRequestId: PLACEHOLDER_ID, media: null }, now).fieldErrors;
}

/**
 * The inline message for one field. It is the same rule set as
 * buildReportRequest, so inline and submit-time messages cannot disagree.
 */
export function validateReportField(field: ValidatedField, values: ReportFormValues, now: Date = new Date()): string | undefined {
  return collectFieldErrors(values, now)[field];
}

export type BuildResult = { ok: true; data: ReportSubmissionRequest } | { ok: false; fieldErrors: ReportFieldErrors };

/** Turns form values into a schema-valid request body, or per-field messages. */
export function buildReportRequest(
  values: ReportFormValues,
  ids: { clientRequestId: string; media: ReportMediaUpload | null },
  now: Date = new Date(),
): BuildResult {
  const { fieldErrors, parsed } = evaluate(values, ids, now);
  if (Object.keys(fieldErrors).length > 0 || !parsed.success) return { ok: false, fieldErrors };
  return { ok: true, data: parsed.data };
}

/** What the form should do with ids after an error. */
export type RetryAdvice = "retry_same" | "new_media" | "none";

export type MappedApiError = {
  message: string;
  fieldErrors: ReportFieldErrors;
  retry: RetryAdvice;
};

function minutes(seconds: number | undefined): string {
  if (!seconds) return "a minute";
  const m = Math.ceil(seconds / 60);
  return m <= 1 ? "a minute" : `${m} minutes`;
}

/**
 * Maps a non-2xx response to friendly copy. Server messages are never shown;
 * per-field messages come from the shared contract schema, keyed by top-level field.
 */
export function mapApiError(status: number, body: unknown): MappedApiError {
  const parsed = apiErrorResponseSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : undefined;
  const fieldErrors: ReportFieldErrors = {};

  if (parsed.success && parsed.data.error.fieldErrors) {
    const known = new Set<string>(["location", "observedAt", "description", "media"]);
    for (const [key, messages] of Object.entries(parsed.data.error.fieldErrors)) {
      if (known.has(key) && messages[0]) fieldErrors[key as ReportField] = messages[0];
    }
  }

  if (status === 401 || code === "unauthorized") {
    return { message: "Your session has ended. Sign in again, then resend the report.", fieldErrors, retry: "retry_same" };
  }
  if (status === 429 || code === "rate_limited") {
    const wait = parsed.success ? parsed.data.error.retryAfterSeconds : undefined;
    return { message: `You've sent several reports in a short time. Please wait ${minutes(wait)} and try again.`, fieldErrors, retry: "retry_same" };
  }
  if (code === "conflict" || status === 409) {
    return { message: "That photo is already attached to another report. Send again to upload it as a new photo.", fieldErrors, retry: "new_media" };
  }
  if (code === "media_invalid") {
    return { message: "We couldn't verify the photo. Send again to re-upload it, or remove the photo.", fieldErrors, retry: "new_media" };
  }
  if (status === 413 || code === "payload_too_large") {
    return { message: "The report is too large. Shorten the description and try again.", fieldErrors, retry: "retry_same" };
  }
  if (status === 400 || code === "validation_failed") {
    return { message: "Some fields need attention.", fieldErrors, retry: "retry_same" };
  }
  return { message: "We couldn't send your report just now. Your details are kept; please try again.", fieldErrors, retry: "retry_same" };
}
