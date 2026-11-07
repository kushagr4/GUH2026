import {
  LOCATION_UNCERTAINTY_METERS,
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

function parseCoordinate(raw: string, min: number, max: number, name: string): { value?: number; error?: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { error: `Enter a ${name}, or use your approximate location.` };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { error: `Enter the ${name} as a number, e.g. ${name === "latitude" ? "53.48" : "-2.24"}.` };
  if (value < min || value > max) return { error: `The ${name} must be between ${min} and ${max}.` };
  return { value: roundTo(value, COORDINATE_DECIMALS) };
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

export type BuildResult = { ok: true; data: ReportSubmissionRequest } | { ok: false; fieldErrors: ReportFieldErrors };

/**
 * Turns form values into a schema-valid request body, or per-field messages.
 * `now` is injectable for tests; observed times later than it are rejected
 * (stricter than the server's five-minute grace).
 */
export function buildReportRequest(
  values: ReportFormValues,
  ids: { clientRequestId: string; media: ReportMediaUpload | null },
  now: Date = new Date(),
): BuildResult {
  const fieldErrors: ReportFieldErrors = {};

  const latitude = parseCoordinate(values.latitude, -90, 90, "latitude");
  const longitude = parseCoordinate(values.longitude, -180, 180, "longitude");
  if (latitude.error) fieldErrors.latitude = latitude.error;
  if (longitude.error) fieldErrors.longitude = longitude.error;

  const observedAt = localDateTimeToUtcIso(values.observedAtLocal);
  if (!observedAt) fieldErrors.observedAt = "Enter when you saw it.";
  else if (Date.parse(observedAt) > now.getTime()) fieldErrors.observedAt = "That time is in the future.";

  const candidate = {
    clientRequestId: ids.clientRequestId,
    observedAt: observedAt ?? "",
    location: {
      latitude: latitude.value ?? Number.NaN,
      longitude: longitude.value ?? Number.NaN,
      uncertaintyMeters: values.uncertaintyMeters,
    },
    description: values.description,
    media: ids.media,
  };
  const parsed = reportSubmissionRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issueField(issue.path);
      fieldErrors[field] ??= issue.message;
    }
  }
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
